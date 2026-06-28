const express = require('express');
const crypto = require('crypto');
const { pool } = require('../config/db');
const prisma = require('../utils/prisma');
const { authenticateUser } = require('../middleware/auth');
const { ratingLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// Helper to format name using display_preference (same logic as formatting.js / formatting.ts)
function getFormattedName(user) {
  if (!user) return 'Anonymous';
  const name = user.name || '';
  const screenName = user.screen_name || '';
  const displayPreference = user.display_preference || 'Show Real Name Only';

  if (displayPreference === 'Show Screen Name Only' && screenName) {
    return screenName;
  }
  if (displayPreference === 'Show Real and Screen Name' && screenName) {
    return `${name} (${screenName})`;
  }
  return name;
}

// GET /api/ratings/status/:ratedUserId - Fetch own rating and aggregated rating statistics
router.get('/status/:ratedUserId', async (req, res) => {
  try {
    const ratedUserId = Number(req.params.ratedUserId);
    if (isNaN(ratedUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid Rated User ID' });
    }

    // 1. Get average rating and count
    const [statsRows] = await pool.query(
      `SELECT AVG(rating) as averageRating, COUNT(rating) as ratingCount
       FROM user_ratings
       WHERE rated_user_id = ?`,
      [ratedUserId]
    );

    const averageRating = statsRows[0] && statsRows[0].averageRating ? parseFloat(statsRows[0].averageRating).toFixed(1) : '0.0';
    const ratingCount = statsRows[0] && statsRows[0].ratingCount ? Number(statsRows[0].ratingCount) : 0;

    // 2. Get current user's rating (if authenticated)
    let userRating = 0;
    // We try to extract user from cookies/authorization header manually or check if authenticated
    // For simplicity, if cookie token exists, let's fetch it, otherwise just leave userRating as 0.
    // However, we can use the optional/standard auth approach. Let's see if we can decode jwt or if authenticateUser can be optional.
    // If authenticateUser is used, it throws 401 if missing. Let's write custom decode logic, or just check req.cookies or authorization.
    const token = req.cookies?.token || req.headers.authorization?.split(' ')[1];
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'nexus_jwt_secret');
        if (decoded && decoded.id) {
          const [ratingRows] = await pool.query(
            `SELECT rating FROM user_ratings WHERE rated_user_id = ? AND rated_by_id = ? LIMIT 1`,
            [ratedUserId, decoded.id]
          );
          if (ratingRows.length > 0) {
            userRating = ratingRows[0].rating;
          }
        }
      } catch (err) {
        // Ignore token verify error for stats fetching
      }
    }

    res.json({
      success: true,
      data: {
        averageRating: parseFloat(averageRating),
        ratingCount,
        userRating
      }
    });
  } catch (error) {
    console.error('Fetch ratings status error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not fetch rating status'
    });
  }
});

// POST /api/ratings - Create or update rating (authenticated users only)
router.post('/', authenticateUser, ratingLimiter, async (req, res) => {
  try {
    const { ratedUserId, rating } = req.body;
    const ratedUserIdNum = Number(ratedUserId);
    const ratingNum = Number(rating);

    if (isNaN(ratedUserIdNum)) {
      return res.status(400).json({ success: false, message: 'Invalid Rated User ID' });
    }

    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be an integer between 1 and 5' });
    }

    const ratedById = Number(req.user.id);

    // Prevent self-rating
    if (ratedUserIdNum === ratedById) {
      return res.status(400).json({
        success: false,
        message: 'Self-rating is strictly prohibited.'
      });
    }

    // Verify target user exists
    const [userCheck] = await pool.query('SELECT id FROM users WHERE id = ? LIMIT 1', [ratedUserIdNum]);
    if (userCheck.length === 0) {
      return res.status(404).json({ success: false, message: 'Target user not found' });
    }

    // Check if rating already exists to determine if it is new
    const [existingRows] = await pool.query(
      `SELECT rating FROM user_ratings WHERE rated_user_id = ? AND rated_by_id = ? LIMIT 1`,
      [ratedUserIdNum, ratedById]
    );
    const isNew = existingRows.length === 0;

    // Upsert rating using INSERT ON DUPLICATE KEY UPDATE
    await pool.query(
      `INSERT INTO user_ratings (rated_user_id, rated_by_id, rating, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE rating = ?, updated_at = NOW()`,
      [ratedUserIdNum, ratedById, ratingNum, ratingNum]
    );

    // Trigger notification if it's a new rating
    if (isNew) {
      try {
        const { createNotification } = require('../utils/notifications');
        const [raterRows] = await pool.query(
          `SELECT name, screen_name, display_preference FROM users WHERE id = ? LIMIT 1`,
          [ratedById]
        );
        const raterName = raterRows.length > 0 ? getFormattedName(raterRows[0]) : 'Someone';
        
        await createNotification({
          userId: ratedUserIdNum,
          type: 'rating_received',
          title: 'New Rating Received',
          body: `${raterName} rated you ${ratingNum} stars!`,
          linkUrl: `/profile?id=${ratedById}`
        });
      } catch (notifErr) {
        console.error('Failed to create rating notification:', notifErr.message);
      }
    }

    // Track Graphifyy Analytics event
    try {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const salt = process.env.JWT_SECRET || 'fallback-analytics-salt-v1';
      const hashedIp = crypto.createHash('sha256').update(String(ip) + salt).digest('hex').substring(0, 16);
      
      await prisma.analyticsEvent.create({
        data: {
          user_id: ratedUserIdNum,
          event_type: 'profile_rated',
          target_id: ratedById,
          visitor_ip: hashedIp
        }
      });
    } catch (analyticsErr) {
      console.error('Failed to track profile_rated event:', analyticsErr.message);
    }

    // Trigger Pusher leaderboard update if configured
    if (process.env.PUSHER_APP_ID) {
      try {
        const Pusher = require('pusher');
        const pusher = new Pusher({
          appId: process.env.PUSHER_APP_ID || '',
          key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
          secret: process.env.PUSHER_SECRET || '',
          cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
          useTLS: true
        });
        pusher.trigger('global-events', 'leaderboard-update', {});
      } catch (pusherErr) {
        console.error('Failed to trigger Pusher leaderboard-update:', pusherErr.message);
      }
    }

    // Fetch updated stats to return
    const [statsRows] = await pool.query(
      `SELECT AVG(rating) as averageRating, COUNT(rating) as ratingCount
       FROM user_ratings
       WHERE rated_user_id = ?`,
      [ratedUserIdNum]
    );
    const averageRating = statsRows[0] && statsRows[0].averageRating ? parseFloat(statsRows[0].averageRating).toFixed(1) : '0.0';
    const ratingCount = statsRows[0] && statsRows[0].ratingCount ? Number(statsRows[0].ratingCount) : 0;

    res.json({
      success: true,
      message: 'Rating submitted successfully',
      data: {
        averageRating: parseFloat(averageRating),
        ratingCount,
        userRating: ratingNum
      }
    });
  } catch (error) {
    console.error('Submit rating error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not submit rating'
    });
  }
});

// DELETE /api/ratings/:ratedUserId - Remove own rating for a user
router.delete('/:ratedUserId', authenticateUser, ratingLimiter, async (req, res) => {
  try {
    const ratedUserId = Number(req.params.ratedUserId);
    if (isNaN(ratedUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid Rated User ID' });
    }

    const ratedById = Number(req.user.id);

    const [deleteResult] = await pool.query(
      `DELETE FROM user_ratings WHERE rated_user_id = ? AND rated_by_id = ?`,
      [ratedUserId, ratedById]
    );

    if (deleteResult.affectedRows === 0) {
      return res.status(404).json({ success: false, message: 'Rating not found' });
    }

    // Track Graphifyy Analytics event
    try {
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
      const salt = process.env.JWT_SECRET || 'fallback-analytics-salt-v1';
      const hashedIp = crypto.createHash('sha256').update(String(ip) + salt).digest('hex').substring(0, 16);
      
      await prisma.analyticsEvent.create({
        data: {
          user_id: ratedUserId,
          event_type: 'rating_removed',
          target_id: ratedById,
          visitor_ip: hashedIp
        }
      });
    } catch (analyticsErr) {
      console.error('Failed to track rating_removed event:', analyticsErr.message);
    }

    // Trigger Pusher leaderboard update if configured
    if (process.env.PUSHER_APP_ID) {
      try {
        const Pusher = require('pusher');
        const pusher = new Pusher({
          appId: process.env.PUSHER_APP_ID || '',
          key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
          secret: process.env.PUSHER_SECRET || '',
          cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
          useTLS: true
        });
        pusher.trigger('global-events', 'leaderboard-update', {});
      } catch (pusherErr) {
        console.error('Failed to trigger Pusher leaderboard-update:', pusherErr.message);
      }
    }

    // Fetch updated stats to return
    const [statsRows] = await pool.query(
      `SELECT AVG(rating) as averageRating, COUNT(rating) as ratingCount
       FROM user_ratings
       WHERE rated_user_id = ?`,
      [ratedUserId]
    );
    const averageRating = statsRows[0] && statsRows[0].averageRating ? parseFloat(statsRows[0].averageRating).toFixed(1) : '0.0';
    const ratingCount = statsRows[0] && statsRows[0].ratingCount ? Number(statsRows[0].ratingCount) : 0;

    res.json({
      success: true,
      message: 'Rating deleted successfully',
      data: {
        averageRating: parseFloat(averageRating),
        ratingCount,
        userRating: 0
      }
    });
  } catch (error) {
    console.error('Delete rating error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not delete rating'
    });
  }
});

// GET /api/ratings/leaderboard - Fetch aggregated creator leaderboard sorted by average ratings
router.get('/leaderboard', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.role, u.college, u.city, u.avatar_url, u.gender, u.credits,
              u.screen_name, u.display_preference, u.email_verified,
              AVG(r.rating) as averageRating, COUNT(r.rating) as ratingCount
       FROM users u
       INNER JOIN user_ratings r ON u.id = r.rated_user_id
       GROUP BY u.id
       ORDER BY averageRating DESC, ratingCount DESC, u.credits DESC
       LIMIT 100`
    );

    const formattedRows = rows.map(r => ({
      ...r,
      displayName: getFormattedName(r),
      averageRating: parseFloat(parseFloat(r.averageRating).toFixed(1)),
      ratingCount: Number(r.ratingCount),
      email_verified: r.email_verified === 1 || r.email_verified === true
    }));

    res.json({
      success: true,
      data: formattedRows
    });
  } catch (error) {
    console.error('Fetch ratings leaderboard error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not fetch ratings leaderboard'
    });
  }
});

module.exports = router;
