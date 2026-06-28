const express = require('express');
const { pool } = require('../config/db');
const { authenticateUser, requireVerified } = require('../middleware/auth');
const { portfolioLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

// GET /api/portfolio/user/:userId - Fetch portfolio items for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, message: 'Invalid User ID' });
    }

    const [rows] = await pool.query(
      `SELECT id, user_id, title, genre, synopsis, media_links, role_data, work_type, status, created_at, updated_at
       FROM portfolio_work
       WHERE user_id = ?
       ORDER BY created_at DESC, id DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: rows
    });
  } catch (error) {
    console.error('Fetch user portfolio error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not fetch portfolio items'
    });
  }
});

// POST /api/portfolio - Add new portfolio item
router.post('/', authenticateUser, requireVerified, portfolioLimiter, async (req, res) => {
  try {
    const { title, genre, synopsis, media_links, role_data, work_type, status } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Project title is required'
      });
    }

    const [result] = await pool.query(
      `INSERT INTO portfolio_work (
        user_id, title, genre, synopsis, media_links, role_data, work_type, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        req.user.id,
        String(title).trim(),
        genre || null,
        synopsis || null,
        media_links || null,
        role_data || null,
        work_type || 'Script',
        status || 'Portfolio Item'
      ]
    );

    const [rows] = await pool.query(
      'SELECT * FROM portfolio_work WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    res.status(201).json({
      success: true,
      message: 'Portfolio item added successfully',
      data: rows[0]
    });
  } catch (error) {
    console.error('Portfolio insert error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not add portfolio item'
    });
  }
});

// PUT /api/portfolio/:id - Update portfolio item
router.put('/:id', authenticateUser, portfolioLimiter, async (req, res) => {
  try {
    const portfolioId = Number(req.params.id);
    if (isNaN(portfolioId)) {
      return res.status(400).json({ success: false, message: 'Invalid portfolio ID' });
    }

    const { title, genre, synopsis, media_links, role_data, work_type, status } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Project title is required'
      });
    }

    // Check ownership
    const [rows] = await pool.query(
      'SELECT user_id FROM portfolio_work WHERE id = ? LIMIT 1',
      [portfolioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Portfolio item not found' });
    }

    if (Number(rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to edit this portfolio item' });
    }

    await pool.query(
      `UPDATE portfolio_work SET
        title = ?,
        genre = ?,
        synopsis = ?,
        media_links = ?,
        role_data = ?,
        work_type = ?,
        status = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [
        String(title).trim(),
        genre || null,
        synopsis || null,
        media_links || null,
        role_data || null,
        work_type || 'Script',
        status || 'Portfolio Item',
        portfolioId
      ]
    );

    const [updatedRows] = await pool.query(
      'SELECT * FROM portfolio_work WHERE id = ? LIMIT 1',
      [portfolioId]
    );

    res.json({
      success: true,
      message: 'Portfolio item updated successfully',
      data: updatedRows[0]
    });
  } catch (error) {
    console.error('Portfolio update error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not update portfolio item'
    });
  }
});

// DELETE /api/portfolio/:id - Delete portfolio item
router.delete('/:id', authenticateUser, portfolioLimiter, async (req, res) => {
  try {
    const portfolioId = Number(req.params.id);
    if (isNaN(portfolioId)) {
      return res.status(400).json({ success: false, message: 'Invalid portfolio ID' });
    }

    // Check ownership
    const [rows] = await pool.query(
      'SELECT user_id FROM portfolio_work WHERE id = ? LIMIT 1',
      [portfolioId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Portfolio item not found' });
    }

    if (Number(rows[0].user_id) !== Number(req.user.id)) {
      return res.status(403).json({ success: false, message: 'Unauthorized to delete this portfolio item' });
    }

    await pool.query('DELETE FROM portfolio_work WHERE id = ?', [portfolioId]);

    res.json({
      success: true,
      message: 'Portfolio item deleted successfully'
    });
  } catch (error) {
    console.error('Portfolio delete error:', error.message);
    res.status(500).json({
      success: false,
      message: 'Could not delete portfolio item'
    });
  }
});

module.exports = router;
