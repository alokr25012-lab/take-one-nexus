const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { pool } = require('../config/db');
const { authenticateUser, requireVerified, requireRole, requireAdmin } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const Pusher = require('pusher');

const router = express.Router();

// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true
});

/**
 * Helper to check if a user role is authorized to upload scripts.
 * In the new ecosystem, all roles are permitted to showcase their work.
 */
function isCreatorRole(role) {
  return true;
}

const { captureError } = require('../src/lib/sentry');

const LOCAL_ASSET_ROOTS = [
  path.resolve(__dirname, '..', 'public'),
  path.resolve(__dirname, '..', 'uploads')
];

// Restrict deletion to uploads directory only to prevent deletion of core application assets
const DELETION_SAFE_ROOTS = [
  path.resolve(__dirname, '..', 'public', 'assets', 'uploads')
];

// ---------------------------------------------------------------------
// Rate limiters
// CodeQL: every route that performs authorization should be rate-limited
// to prevent brute-force / spam / abuse of authenticated endpoints.
// ---------------------------------------------------------------------

// Search rate limit — public, read-only, but still needs throttling
const searchLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 1000, // 1 minute
  keyPrefix: 'script_search'
});

// Portfolio rate limit — prevents spam upload of unmoderated portfolio entries
const portfolioLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'portfolio'
});

// Script create rate limit
const createLimiter = createRateLimiter({
  limit: 20,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'script_create'
});

// Script update rate limit
const updateLimiter = createRateLimiter({
  limit: 30,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'script_update'
});

// Script delete rate limit
const deleteLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'script_delete'
});

// Moderation rate limit (admin/developer actions)
const moderationLimiter = createRateLimiter({
  limit: 100,
  windowMs: 60 * 60 * 1000, // 1 hour
  keyPrefix: 'script_moderate'
});

async function safeQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error(`Database query failed: ${sql}`);
    console.error(`Error: ${error.message}`);
    captureError(error, {
      action: 'database_query_failure',
      extra: { sql, params }
    });
    throw error;
  }
}

function parseAssetCandidates(script) {
  const values = [
    script.poster_url,
    script.file_url,
    script.pdf_url,
    script.thumbnail_url
  ];

  try {
    const media = script.media_links ? JSON.parse(script.media_links) : null;
    if (Array.isArray(media)) values.push(...media);
    if (media && typeof media === 'object') values.push(...Object.values(media));
  } catch {
    values.push(script.media_links);
  }

  return values
    .flat()
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
}

function toSafeLocalPath(assetPath) {
  if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith('data:')) return null;

  const cleanPath = assetPath.split('?')[0].split('#')[0];
  const candidates = cleanPath.startsWith('/')
    ? [path.resolve(__dirname, '..', 'public', cleanPath.replace(/^\/+/, ''))]
    : [path.resolve(__dirname, '..', cleanPath)];

  return candidates.find((candidate) =>
    LOCAL_ASSET_ROOTS.some((root) => candidate === root || candidate.startsWith(`${root}${path.sep}`))
  ) || null;
}

// Strict path validation for deletion operations - only allows uploads directory
function toSafeDeletionPath(assetPath) {
  if (/^https?:\/\//i.test(assetPath) || assetPath.startsWith('data:')) return null;

  const cleanPath = assetPath.split('?')[0].split('#')[0];

  // Additional check: prevent path traversal attempts
  const hasTraversal = cleanPath.includes('..') || cleanPath.includes('~');
  if (hasTraversal) return null;

  let candidates;
  // Handle absolute paths starting with /uploads/ specially
  if (cleanPath.startsWith('/uploads/')) {
    // Resolve directly against uploads directory
    candidates = [path.resolve(__dirname, '..', 'public', 'assets', 'uploads', cleanPath.replace(/^\/+uploads\/+/, ''))];
  } else if (cleanPath.startsWith('/')) {
    // Other absolute paths resolve against public (will be rejected by root check)
    candidates = [path.resolve(__dirname, '..', 'public', cleanPath.replace(/^\/+/, ''))];
  } else {
    // Relative paths resolve normally
    candidates = [path.resolve(__dirname, '..', cleanPath)];
  }

  // Normalize paths for comparison
  const normalizedCandidates = candidates.map(c => path.normalize(c));

  return normalizedCandidates.find((candidate) => {
    // Ensure the path is within one of the deletion-safe roots
    const isWithinSafeRoot = DELETION_SAFE_ROOTS.some((root) => {
      const normalizedRoot = path.normalize(root);
      return candidate.startsWith(`${normalizedRoot}${path.sep}`);
    });

    return isWithinSafeRoot;
  }) || null;
}

async function deleteLocalAssets(script) {
  const deleted = [];
  const failed = [];

  for (const asset of parseAssetCandidates(script)) {
    const localPath = toSafeDeletionPath(asset);
    if (!localPath) continue;

    try {
      await fs.unlink(localPath);
      deleted.push(asset);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        failed.push({ asset, message: error.message });
      }
    }
  }

  if (failed.length > 0) {
    captureError(new Error('Some script assets could not be deleted'), {
      action: 'script_asset_delete_partial_failure',
      extra: { scriptId: script.id, failed }
    });
  }

  return deleted;
}

async function getFreshUser(userId) {
  const [rows] = await pool.query(
    'SELECT id, role, secondary_role, email FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  return rows[0] || null;
}

function hasElevatedScriptDeleteAccess(user) {
  const roles = [user?.role, user?.secondary_role].map((role) => String(role || '').toLowerCase());
  return roles.includes('admin') ||
    roles.includes('moderator') ||
    roles.includes('founder');
}

function isVerifiedUser(user) {
  return user?.email_verified === true || user?.email_verified === 1;
}

function isPortfolioScript(script) {
  return String(script?.payment_status || '').toLowerCase() === 'portfolio' ||
    String(script?.approval_status || '').toLowerCase() === 'portfolio' ||
    String(script?.status || '').toLowerCase() === 'portfolio item';
}

router.get('/', async (req, res) => {
  try {
    const sql = `
      SELECT
        scripts.id,
        scripts.user_id AS owner_id,
        scripts.title,
        scripts.genre,
        scripts.synopsis,
        scripts.status,
        scripts.roles_needed,
        scripts.poster_url,
        scripts.work_type,
        scripts.media_links,
        scripts.role_data,
        users.name AS author_name,
        users.screen_name,
        users.display_preference
      FROM scripts
      LEFT JOIN users ON users.id = scripts.user_id
      WHERE scripts.payment_verified = TRUE
      ORDER BY scripts.created_at DESC, scripts.id DESC LIMIT 50
    `;
    const rows = await safeQuery(sql, []);
    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Fetch all scripts error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not fetch scripts'
    });
  }
});

router.get('/search', searchLimiter, async (req, res) => {
  try {
    const query = String(req.query.q || '').trim();
    const genre = String(req.query.genre || '').trim();

    let sql = `
      SELECT
        scripts.id,
        scripts.user_id AS owner_id,
        scripts.title,
        scripts.genre,
        scripts.synopsis,
        scripts.status,
        scripts.roles_needed,
        scripts.poster_url,
        scripts.work_type,
        scripts.media_links,
        scripts.role_data,
        users.name AS author_name,
        users.screen_name,
        users.display_preference
      FROM scripts
      LEFT JOIN users ON users.id = scripts.user_id
      WHERE scripts.payment_verified = TRUE
    `;
    const params = [];

    if (query) {
      sql += ` AND (scripts.title LIKE ? OR scripts.genre LIKE ? OR scripts.synopsis LIKE ?)`;
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    if (genre) {
      sql += ` AND scripts.genre LIKE ?`;
      params.push(`%${genre}%`);
    }

    sql += ` ORDER BY scripts.created_at DESC, scripts.id DESC LIMIT 20`;

    const rows = await safeQuery(sql, params);

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Script search error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not search scripts'
    });
  }
});

// Legacy portfolio endpoint removed. All portfolio work goes through /api/portfolio.

router.post('/', authenticateUser, requireVerified, createLimiter, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const [userRows] = await pool.query('SELECT secondary_role FROM users WHERE id = ? LIMIT 1', [userId]);
    const isFounder = userRows && userRows[0] && userRows[0].secondary_role?.toLowerCase() === 'founder';

    if (isFounder) {
      const { title, genre, synopsis, poster_url, roles_needed, status, media_links, role_data, work_type } = req.body;
      if (!title) {
        return res.status(400).json({ success: false, message: 'Script title is required' });
      }

      const [insertResult] = await pool.query(
        `INSERT INTO scripts (
          user_id, title, genre, synopsis, poster_url, roles_needed, 
          status, media_links, role_data, work_type, approval_status, payment_status, payment_id, payment_verified, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'free', 'founder_bypass', TRUE, NOW(), NOW())`,
        [
          userId,
          title,
          genre || 'General',
          synopsis || '',
          poster_url || null,
          roles_needed || null,
          status || 'Open for collaboration',
          media_links || null,
          role_data || null,
          work_type || 'Script'
        ]
      );

      const scriptId = insertResult.insertId;
      return res.status(201).json({
        success: true,
        message: 'Script uploaded successfully as Founder bypass',
        scriptId
      });
    }

    return res.status(402).json({
      success: false,
      message: 'Payment verification required. Use /api/payments/create-order and /api/payments/verify before script submission.',
      code: 'PAYMENT_REQUIRED'
    });
  } catch (error) {
    console.error('Script upload error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not upload script'
    });
  }
});

router.put('/:id', authenticateUser, updateLimiter, async (req, res) => {
  try {
    const scriptId = Number(req.params.id);
    const { title, genre, synopsis, roles_needed, status, work_type, media_links, role_data, poster_url } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Script title is required'
      });
    }

    // Check ownership
    const [rows] = await pool.query('SELECT user_id, status, payment_status, approval_status FROM scripts WHERE id = ? LIMIT 1', [scriptId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Script not found' });
    }

    if (Number(rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to edit this script' });
    }

    if (!isVerifiedUser(req.user) && !isPortfolioScript(rows[0])) {
      return res.status(403).json({
        success: false,
        message: 'Email verification required to edit submitted scripts.'
      });
    }

    await pool.query(
      `UPDATE scripts SET 
        title = ?, genre = ?, synopsis = ?, roles_needed = ?, status = ?, 
        work_type = ?, media_links = ?, role_data = ?, poster_url = ?, updated_at = NOW()
       WHERE id = ?`,
      [
        String(title).trim(),
        genre || null,
        synopsis || null,
        roles_needed || null,
        status || 'Open for collaboration',
        work_type || 'Script',
        media_links || null,
        role_data || null,
        poster_url || null,
        scriptId
      ]
    );

    const [scriptRows] = await pool.query(
      `SELECT * FROM scripts WHERE id = ? LIMIT 1`,
      [scriptId]
    );

    res.json({
      success: true,
      message: 'Script updated successfully',
      data: scriptRows[0]
    });
  } catch (error) {
    console.error('Script update error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not update script'
    });
  }
});

router.delete('/:id', authenticateUser, deleteLimiter, async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const scriptId = Number(req.params.id);
    if (!Number.isFinite(scriptId)) {
      return res.status(400).json({ success: false, message: 'Invalid script id' });
    }

    const [rows] = await connection.query('SELECT * FROM scripts WHERE id = ? LIMIT 1', [scriptId]);
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Script not found' });
    }

    const script = rows[0];
    const freshUser = await getFreshUser(req.user.id);
    const isOwner = Number(script.user_id) === Number(req.user.id);
    const canModerateDelete = hasElevatedScriptDeleteAccess(freshUser);

    if (!isOwner && !canModerateDelete) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this script' });
    }

    if (isOwner && !isVerifiedUser(req.user) && !isPortfolioScript(script)) {
      return res.status(403).json({
        success: false,
        message: 'Email verification required to delete submitted scripts.'
      });
    }

    await connection.beginTransaction();

    await connection.query('DELETE FROM collaboration_requests WHERE script_id = ?', [scriptId]);
    await connection.query('DELETE FROM script_upload_payments WHERE script_id = ?', [scriptId]);
    await connection.query('DELETE FROM scripts WHERE id = ?', [scriptId]);
    await connection.query(
      `INSERT INTO moderation_logs (moderator_id, action, script_id, created_at)
       VALUES (?, 'SCRIPT_DELETED', ?, NOW())`,
      [req.user.id, scriptId]
    );

    await connection.commit();
    const deletedAssets = await deleteLocalAssets(script);

    if (process.env.PUSHER_APP_ID) {
      pusher.trigger('admin-dashboard', 'update', {
        type: 'SCRIPT_DELETED',
        scriptId
      });
      pusher.trigger('global-events', 'leaderboard-update', {});
    }

    res.json({
      success: true,
      message: 'Script deleted successfully',
      deleted_assets: deletedAssets
    });
  } catch (error) {
    await connection.rollback();
    console.error('Script deletion error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not delete script'
    });
  } finally {
    connection.release();
  }
});

/**
 * PATCH /api/scripts/:id/moderate
 * Approve or reject a script (Admin only)
 * Body: { action: 'approved' | 'rejected' | 'pending', moderation_notes?: string }
 */
router.patch('/:id/moderate', authenticateUser, requireAdmin, moderationLimiter, async (req, res) => {
  try {
    const scriptId = Number(req.params.id);
    const { action, moderation_notes } = req.body;

    const allowed = ['approved', 'rejected', 'pending'];
    if (!allowed.includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid moderation action' });
    }

    const now = action === 'approved' ? new Date() : null;

    await pool.query(
      `UPDATE scripts SET approval_status = ?, approved_by = ?, approved_at = ?, moderation_notes = ?, updated_at = NOW() WHERE id = ?`,
      [action, req.user.id, now, moderation_notes || null, scriptId]
    );

    const [rows] = await pool.query(
      `SELECT scripts.*, users.email AS author_email, users.name AS author_name
       FROM scripts LEFT JOIN users ON users.id = scripts.user_id
       WHERE scripts.id = ? LIMIT 1`,
      [scriptId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Script not found' });
    }

    const script = rows[0];

    // Award script approval credits if approved
    if (action === 'approved' && script.user_id) {
      try {
        const { awardCreditTask } = require('../utils/seedCreditTasks');
        await awardCreditTask(script.user_id, 'FIRST_SCRIPT_APPROVAL');
      } catch (awardErr) {
        console.error('Failed to award first approved script credits:', awardErr.message);
      }
    }

    // Send rejection email if the script was rejected and Resend is configured
    if (action === 'rejected' && script.author_email && process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        await resend.emails.send({
          from: 'TAKE ONE Nexus <noreply@takeone-nexus.net.in>',
          to: script.author_email,
          subject: `Your work "${script.title}" — Moderation Update`,
          html: `<div style="font-family:monospace;background:#0a0a0a;color:#e8e8e0;padding:32px;border-radius:8px;max-width:560px;">
            <div style="color:#ff6b00;font-size:12px;letter-spacing:3px;margin-bottom:16px;">TAKE ONE NEXUS</div>
            <h2 style="color:#e8e8e0;margin:0 0 16px;">Moderation Update</h2>
            <p>Hi ${script.author_name || 'Creator'},</p>
            <p>Your submission <strong>${script.title}</strong> was reviewed by our moderation team and requires changes before it can go live.</p>
            ${moderation_notes ? `<div style="background:#1a1a1a;border-left:3px solid #ff6b00;padding:12px 16px;margin:16px 0;"><strong>Moderator Notes:</strong><br/>${moderation_notes}</div>` : ''}
            <p>You can edit your submission and resubmit from your profile. If you have questions, reply to this email.</p>
            <p style="color:rgba(232,232,224,0.4);font-size:11px;">TAKE ONE Nexus · Empowering Independent Film Crews</p>
          </div>`
        });
      } catch (emailErr) {
        console.error('Rejection email failed:', emailErr.message);
      }
    }

    // Notify admin dashboard
    if (process.env.PUSHER_APP_ID) {
      pusher.trigger('admin-dashboard', 'update', {
        type: 'SCRIPT_MODERATED',
        scriptId,
        action
      });
    }

    res.json({ success: true, message: `Script ${action}`, data: script });
  } catch (error) {
    console.error('Script moderation error:', error.message);
    res.status(500).json({ success: false, message: 'Could not moderate script' });
  }
});

module.exports = router;