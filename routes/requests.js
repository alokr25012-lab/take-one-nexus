const express = require('express');
const { pool } = require('../config/db');
const { sendCollaborationRequestEmail } = require('../config/mailer');
const { authenticateUser, requireSameUser, requireVerified } = require('../middleware/auth');
const { createNotification } = require('../utils/notifications');
const { getCanonicalDisplayName } = require('../utils/formatting');
const router = express.Router();

let initPromise = null;

async function ensureRequestsTable() {
  if (initPromise) return initPromise;
  
  initPromise = pool.query(`
    CREATE TABLE IF NOT EXISTS collaboration_requests (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      script_id INT UNSIGNED NOT NULL,
      requester_id INT UNSIGNED NOT NULL,
      owner_id INT UNSIGNED NOT NULL,
      message TEXT DEFAULT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_script_requester (script_id, requester_id),
      KEY idx_requests_owner_id (owner_id),
      KEY idx_requests_requester_id (requester_id),
      CONSTRAINT fk_requests_script
        FOREIGN KEY (script_id)
        REFERENCES scripts(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_requests_requester
        FOREIGN KEY (requester_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,
      CONSTRAINT fk_requests_owner
        FOREIGN KEY (owner_id)
        REFERENCES users(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
    )
  `);
  
  return initPromise;
}

router.post('/', authenticateUser, requireVerified, async (req, res) => {
  try {
    await ensureRequestsTable();

    const { script_id, message } = req.body;
    const requesterId = Number(req.user.id);

    if (!script_id) {
      return res.status(400).json({
        success: false,
        message: 'Script id is required'
      });
    }

    const [scriptRows] = await pool.query(
      `SELECT
        scripts.id,
        scripts.user_id,
        scripts.title,
        scripts.genre,
        owners.name AS owner_name,
        owners.email AS owner_email
       FROM scripts
       JOIN users AS owners ON owners.id = scripts.user_id
       WHERE scripts.id = ? AND scripts.payment_verified = TRUE
       LIMIT 1`,
      [script_id]
    );

    if (scriptRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Script not found'
      });
    }

    const script = scriptRows[0];

    const [requesterRows] = await pool.query(
      `SELECT id, name, email, role, college, city, screen_name, display_preference
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [requesterId]
    );

    if (requesterRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Requester account not found'
      });
    }

    const requester = requesterRows[0];

    if (Number(script.user_id) === requesterId) {
      return res.status(400).json({
        success: false,
        message: 'You cannot request to join your own script'
      });
    }

    try {
      const [result] = await pool.query(
        `INSERT INTO collaboration_requests (script_id, requester_id, owner_id, message)
         VALUES (?, ?, ?, ?)`,
        [
          Number(script_id),
          requesterId,
          Number(script.user_id),
          message || null
        ]
      );

      let emailResult = { sent: false, reason: 'Email not attempted' };

      try {
        emailResult = await sendCollaborationRequestEmail({
          owner: {
            id: script.user_id,
            name: script.owner_name,
            email: script.owner_email
          },
          requester,
          script,
          message
        });
      } catch (emailError) {
        console.error('Collaboration email error:', emailError.message);
        emailResult = { sent: false, reason: emailError.message };
      }

      try {
        await createNotification({
          userId: script.user_id,
          type: 'request_received',
          title: 'New crew request',
          body: `${getCanonicalDisplayName(requester)} wants to join "${script.title}" as ${requester.role || 'crew'}.`,
          linkUrl: '/profile#collab'
        });
      } catch (notificationError) {
        console.error('Request notification error:', notificationError.message);
      }

      res.status(201).json({
        success: true,
        message: emailResult.sent
          ? 'Request saved and email sent to the project owner'
          : 'Request saved. Email is not configured or could not be sent.',
        data: {
          id: result.insertId,
          script_id: Number(script_id),
          requester_id: requesterId,
          owner_id: Number(script.user_id),
          status: 'pending',
          email_sent: emailResult.sent,
          email_reason: emailResult.reason || null
        }
      });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: 'You already sent a request for this script'
        });
      }

      throw error;
    }
  } catch (error) {
    console.error('Request create error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not send collaboration request'
    });
  }
});

router.patch('/:id/status', authenticateUser, requireVerified, async (req, res) => {
  try {
    await ensureRequestsTable();

    const requestId = Number(req.params.id);
    const ownerId = Number(req.user.id);
    const status = String(req.body.status || '').trim().toLowerCase();

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be accepted or rejected'
      });
    }

    const [requestRows] = await pool.query(
      `SELECT
        collaboration_requests.id,
        collaboration_requests.status,
        collaboration_requests.owner_id,
        collaboration_requests.requester_id,
        scripts.title AS script_title,
        owners.name AS owner_name,
        owners.screen_name AS owner_screen_name,
        owners.display_preference AS owner_display_preference,
        requesters.name AS requester_name
       FROM collaboration_requests
       JOIN scripts ON scripts.id = collaboration_requests.script_id
       JOIN users AS owners ON owners.id = collaboration_requests.owner_id
       JOIN users AS requesters ON requesters.id = collaboration_requests.requester_id
       WHERE collaboration_requests.id = ?
       LIMIT 1`,
      [requestId]
    );

    if (requestRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    const request = requestRows[0];

    if (Number(request.owner_id) !== ownerId) {
      return res.status(403).json({
        success: false,
        message: 'Only the project owner can update this request'
      });
    }

    await pool.query(
      `UPDATE collaboration_requests
       SET status = ?
       WHERE id = ?`,
      [status, requestId]
    );

    try {
      await createNotification({
        userId: request.requester_id,
        type: `request_${status}`,
        title: `Request ${status}`,
        body: `${getCanonicalDisplayName({
          name: request.owner_name,
          screen_name: request.owner_screen_name,
          display_preference: request.owner_display_preference
        })} ${status} your request for "${request.script_title}".`,
        linkUrl: '/profile#collab'
      });
    } catch (notificationError) {
      console.error('Request status notification error:', notificationError.message);
    }

    res.json({
      success: true,
      message: `Request ${status}`,
      data: {
        id: requestId,
        status
      }
    });
  } catch (error) {
    console.error('Request status error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not update collaboration request'
    });
  }
});

router.get('/user/:id', authenticateUser, requireSameUser, async (req, res) => {
  try {
    await ensureRequestsTable();

    const userId = Number(req.params.id);

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Valid user id is required'
      });
    }

    const [incoming] = await pool.query(
      `SELECT
        collaboration_requests.id,
        collaboration_requests.message,
        collaboration_requests.status,
        collaboration_requests.created_at,
        scripts.title AS script_title,
        scripts.genre AS script_genre,
        users.avatar_url AS requester_avatar_url,
        users.screen_name AS requester_screen_name,
        users.display_preference AS requester_display_preference
       FROM collaboration_requests
       JOIN scripts ON scripts.id = collaboration_requests.script_id
       JOIN users ON users.id = collaboration_requests.requester_id
       WHERE collaboration_requests.owner_id = ?
       ORDER BY collaboration_requests.created_at DESC`,
      [userId]
    );

    const [outgoing] = await pool.query(
      `SELECT
        collaboration_requests.id,
        collaboration_requests.message,
        collaboration_requests.status,
        collaboration_requests.created_at,
        scripts.title AS script_title,
        scripts.genre AS script_genre,
        users.avatar_url AS owner_avatar_url,
        users.screen_name AS owner_screen_name,
        users.display_preference AS owner_display_preference
       FROM collaboration_requests
       JOIN scripts ON scripts.id = collaboration_requests.script_id
       JOIN users ON users.id = collaboration_requests.owner_id
       WHERE collaboration_requests.requester_id = ?
       ORDER BY collaboration_requests.created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        incoming,
        outgoing
      }
    });
  } catch (error) {
    console.error('Request list error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load collaboration requests'
    });
  }
});

module.exports = router;
