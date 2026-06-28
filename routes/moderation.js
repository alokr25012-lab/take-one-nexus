const express = require('express');
const { pool } = require('../config/db');
const { authenticateUser, requireRole, requireVerified, requireModerator } = require('../middleware/auth');

const router = express.Router();

router.post('/reports', authenticateUser, requireVerified, async (req, res) => {
  try {

    const targetType = String(req.body.target_type || 'general').trim().toLowerCase();
    const reason = String(req.body.reason || '').trim();
    const details = String(req.body.details || '').trim();

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Report reason is required'
      });
    }

    const [result] = await pool.query(
      `INSERT INTO moderation_reports
       (reporter_id, target_type, target_id, reason, details)
       VALUES (?, ?, ?, ?, ?)`,
      [
        Number(req.user.id),
        targetType,
        req.body.target_id ? Number(req.body.target_id) : null,
        reason,
        details || null
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Report submitted for review',
      data: {
        id: result.insertId
      }
    });
  } catch (error) {
    console.error('Moderation report create error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not submit report'
    });
  }
});

router.get('/reports', authenticateUser, requireModerator, async (req, res) => {
  try {
    const status = String(req.query.status || '').trim().toLowerCase();
    const params = [];
    let where = '';

    if (status) {
      where = 'WHERE moderation_reports.status = ?';
      params.push(status);
    }

    const [rows] = await pool.query(
      `SELECT
        moderation_reports.id,
        moderation_reports.target_type,
        moderation_reports.target_id,
        moderation_reports.reason,
        moderation_reports.details,
        moderation_reports.status,
        moderation_reports.moderator_notes,
        moderation_reports.moderator_id,
        moderation_reports.created_at,
        reporter.name AS reporter_name,
        reporter.email AS reporter_email,
        moderator.name AS moderator_name,
        moderator.email AS moderator_email
       FROM moderation_reports
       JOIN users reporter ON reporter.id = moderation_reports.reporter_id
       LEFT JOIN users moderator ON moderator.id = moderation_reports.moderator_id
       ${where}
       ORDER BY moderation_reports.created_at DESC
       LIMIT 80`,
      params
    );

    res.json({
      success: true,
      count: rows.length,
      data: rows
    });
  } catch (error) {
    console.error('Moderation report list error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not load reports'
    });
  }
});

router.patch('/reports/:id', authenticateUser, requireModerator, async (req, res) => {
  try {
    const status = String(req.body.status || '').trim().toLowerCase();
    const notes = String(req.body.moderator_notes || '').trim();
    const allowed = ['open', 'reviewing', 'resolved', 'dismissed'];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid report status'
      });
    }

    const [result] = await pool.query(
      `UPDATE moderation_reports
       SET status = ?,
           moderator_notes = ?,
           moderator_id = ?
       WHERE id = ?`,
      [status, notes || null, req.user.id, Number(req.params.id)]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: 'Report not found'
      });
    }

    res.json({
      success: true,
      message: 'Report updated'
    });
  } catch (error) {
    console.error('Moderation report update error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not update report'
    });
  }
});

module.exports = router;
