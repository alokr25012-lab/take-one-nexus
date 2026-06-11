const express = require('express');
const { pool } = require('../config/db');
const { authenticateUser, requireRole } = require('../middleware/auth');
const prisma = require('../utils/prisma');
const {
  getEmailStatus,
  sendSmtpTestEmail,
  verifyEmailConnection
} = require('../config/mailer');

const router = express.Router();


// NOTE: Pusher instance was removed from this file as it is not utilized 
// within the email, stats, or analytics administration routers.

/**
 * @route   GET /email/status
 * @desc    Check system email connectivity and SMTP health status
 * @access  Private (Admin, Developer)
 */
router.get('/email/status', authenticateUser, requireRole(['Admin', 'Developer']), async (req, res) => {
  try {
    const status = getEmailStatus();
    let smtpReachable = false;
    let smtpReason = null;

    if (status.enabled) {
      try {
        const verifyResult = await verifyEmailConnection();
        smtpReachable = Boolean(verifyResult.success);
      } catch (error) {
        smtpReason = error.message;
      }
    }

    res.json({
      success: true,
      data: {
        ...status,
        smtp_reachable: smtpReachable,
        smtp_reason: smtpReason
      }
    });
  } catch (error) {
    console.error('Email status error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not check email status'
    });
  }
});

/**
 * @route   POST /email/test
 * @desc    Send an administrative test verification email to the logged-in operator
 * @access  Private (Admin, Developer)
 */
router.post('/email/test', authenticateUser, requireRole(['Admin', 'Developer']), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [Number(req.user.id)]
    );

    if (rows.length === 0 || !rows[0].email) {
      return res.status(404).json({
        success: false,
        message: 'Logged-in user email not found'
      });
    }

    const result = await sendSmtpTestEmail({
      to: rows[0].email,
      name: rows[0].name
    });

    if (!result.sent) {
      return res.status(400).json({
        success: false,
        message: result.reason || 'SMTP test could not be sent'
      });
    }

    res.json({
      success: true,
      message: `SMTP test sent to ${rows[0].email}`
    });
  } catch (error) {
    console.error('SMTP test error:', error.message);
    res.status(500).json({
      success: false,
      message: error.message || 'Could not send SMTP test'
    });
  }
});

/**
 * @route   GET /analytics
 * @desc    Fetch aggregated registration metrics for the past 30 days
 * @access  Private (Admin, Developer, Moderator)
 */
router.get('/analytics', authenticateUser, requireRole(['Admin', 'Developer', 'Moderator']), async (req, res) => {
  try {
    const [userRows] = await pool.query(`
      SELECT DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) as date, COUNT(*) as count 
      FROM users 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
      GROUP BY DATE(CONVERT_TZ(created_at, '+00:00', '+05:30'))
      ORDER BY date ASC
    `);

    const [scriptRows] = await pool.query(`
      SELECT DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) as date, COUNT(*) as count 
      FROM scripts 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        AND payment_verified = TRUE
      GROUP BY DATE(CONVERT_TZ(created_at, '+00:00', '+05:30'))
      ORDER BY date ASC
    `);

    // Format dates cleanly without double-offset distortions
    const formatRows = (rows) => rows.map(r => ({
      date: new Date(r.date).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric' }),
      count: Number(r.count)
    }));

    res.json({
      success: true,
      data: {
        users: formatRows(userRows),
        scripts: formatRows(scriptRows)
      }
    });
  } catch (error) {
    console.error('Analytics error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load analytics' });
  }
});

/**
 * @route   GET /stats
 * @desc    Fetch comprehensive overview metrics for administrative dashboard widgets
 * @access  Private (Admin, Developer, Moderator)
 */
router.get('/stats', authenticateUser, requireRole(['Admin', 'Developer', 'Moderator']), async (req, res) => {
  try {
    const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [scriptCount] = await pool.query('SELECT COUNT(*) as count FROM scripts WHERE payment_verified = TRUE');
    const [requestCount] = await pool.query('SELECT COUNT(*) as count FROM collaboration_requests');

    // Safe isolated parsing execution block for system issues data matrix
    let issueTotal = 0;
    let openIssues = 0;
    let inProgressIssues = 0;
    let resolvedIssues = 0;
    try {
      const [issueCountResult] = await pool.query('SELECT COUNT(*) as count FROM issues');
      const [openResult] = await pool.query("SELECT COUNT(*) as count FROM issues WHERE status = 'open' OR status = 'Open'");
      const [inProgressResult] = await pool.query("SELECT COUNT(*) as count FROM issues WHERE status = 'in_progress' OR status = 'in-progress' OR status = 'In Progress'");
      const [resolvedResult] = await pool.query("SELECT COUNT(*) as count FROM issues WHERE status = 'resolved' OR status = 'closed' OR status = 'Resolved' OR status = 'Closed'");

      issueTotal = issueCountResult[0]?.count || 0;
      openIssues = openResult[0]?.count || 0;
      inProgressIssues = inProgressResult[0]?.count || 0;
      resolvedIssues = resolvedResult[0]?.count || 0;
    } catch (e) {
      console.warn('Could not query issues table for stats:', e.message);
    }

    const [recentUsers] = await pool.query(`
      SELECT id, name, email, role, college, city, created_at 
      FROM users 
      ORDER BY created_at DESC 
      LIMIT 5
    `);

    res.json({
      success: true,
      data: {
        counts: {
          users: userCount[0].count,
          scripts: scriptCount[0].count,
          requests: requestCount[0].count,
          issues: issueTotal,
          openIssues: openIssues,
          inProgressIssues: inProgressIssues,
          resolvedIssues: resolvedIssues
        },
        recentUsers: recentUsers
      }
    });
  } catch (error) {
    console.error('Stats error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load stats' });
  }
});

/**
 * @route   POST /analytics/cleanup
 * @desc    Delete analytics events older than retention period
 * @access  Private (Admin, Developer)
 */
router.post('/analytics/cleanup', authenticateUser, requireRole(['Admin', 'Developer']), async (req, res) => {
  try {
    const retentionDays = parseInt(process.env.ANALYTICS_RETENTION_DAYS || '90', 10);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const result = await prisma.analyticsEvent.deleteMany({
      where: {
        created_at: {
          lt: cutoffDate
        }
      }
    });

    console.log(`[Analytics Cleanup] Deleted ${result.count} analytics events older than ${retentionDays} days`);

    res.json({
      success: true,
      message: `Deleted ${result.count} analytics events older than ${retentionDays} days`,
      deleted_count: result.count,
      cutoff_date: cutoffDate.toISOString()
    });
  } catch (error) {
    console.error('Analytics cleanup error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not cleanup analytics data'
    });
  }
});

module.exports = router;