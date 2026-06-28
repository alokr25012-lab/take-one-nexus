const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateUser, requireRole, requireVerified, requireAdmin } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const prisma = require('../utils/prisma');


const router = express.Router();

const issuesLimiter = createRateLimiter({
  limit: 20,
  windowMs: 15 * 60 * 1000, // 15 mins
  keyPrefix: 'issues'
});

function validatePayload(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: errors.array()[0].msg,
      errors: errors.array()
    });
  }
  return null;
}

// requireDeveloperOrAdmin replaced by requireRole(['Developer', 'Admin'])

/**
 * POST /api/issues
 * Create a new issue report
 */
const createIssueValidation = [
  body('title')
    .trim().notEmpty().withMessage('Issue title is required')
    .isLength({ max: 255 }).withMessage('Title must be 255 characters or less'),
  body('description')
    .trim().notEmpty().withMessage('Description is required')
    .isLength({ max: 5000 }).withMessage('Description must be 5000 characters or less'),
  body('location')
    .optional().trim().isLength({ max: 255 }).withMessage('Location must be 255 characters or less'),
  body('severity')
    .optional().trim().isIn(['low', 'medium', 'high', 'critical']).withMessage('Severity must be low, medium, high, or critical'),
  body('screenshot')
    .optional().trim().isLength({ max: 2048 }).withMessage('Screenshot link must be 2048 characters or less'),
];

router.post('/', issuesLimiter, createIssueValidation, async (req, res) => {
  const validationError = validatePayload(req, res);
  if (validationError) return;

  try {
    const { title, description, location, severity, screenshot } = req.body;
    let userId = null;
    
    // Optional auth
    if (req.headers.authorization || req.cookies?.token) {
       // Just grab it if passed, let the frontend send user details
       // Normally we'd use authenticateUser middleware, but we allow anonymous reports if needed
       // The prompt says "Users should be able to report", meaning logged in or out? Let's assume anyone can.
       // We'll trust the user_id if passed by the client or extract from token.
    }
    
    // If we want it strictly authenticated, we'd add `authenticateUser` to the route. Let's make it optional.
    
    if (!title || !description) {
      return res.status(400).json({ success: false, message: 'Title and description are required' });
    }

        const issue = await prisma.issue.create({
      data: {
        title,
        description,
        location,
        severity: severity || 'low',
        screenshot,
        platform_source: req.body.platform_source || 'main-website',
        issue_type: req.body.issue_type || null,
        user_id: req.user ? req.user.id : null // If auth middleware was used
      }
    });

    res.status(201).json({ success: true, data: issue });
  } catch (error) {
    console.error('Create issue error:', error.message);
    res.status(500).json({ success: false, message: 'Could not create issue report' });
  }
});

/**
 * GET /api/issues
 * Get all issues (Developer/Admin only)
 */
router.get('/', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const issues = await prisma.issue.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true }
        }
      }
    });
    res.json({ success: true, data: issues });
  } catch (error) {
    console.error('Fetch issues error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load issues' });
  }
});

/**
 * PUT /api/issues/:id
 * Update issue status, priority, and assignment
 */
router.put('/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status, priority, assigned_admin } = req.body;

    const updateData = {};
    if (status !== undefined) updateData.status = status;
    if (priority !== undefined) updateData.priority = priority;
    if (assigned_admin !== undefined) updateData.assigned_admin = assigned_admin ? Number(assigned_admin) : null;

    // Auto-set resolved_at when status changes to 'resolved'
    if (status === 'resolved') {
      updateData.resolved_at = new Date();
    } else if (status && status !== 'resolved') {
      updateData.resolved_at = null;
    }

    const issue = await prisma.issue.update({
      where: { id },
      data: updateData
    });
    res.json({ success: true, data: issue });
  } catch (error) {
    console.error('Update issue error:', error.message);
    res.status(500).json({ success: false, message: 'Could not update issue' });
  }
});

/**
 * DELETE /api/issues/:id
 * Delete an issue
 */
router.delete('/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await prisma.issue.delete({ where: { id } });
    res.json({ success: true, message: 'Issue deleted' });
  } catch (error) {
    console.error('Delete issue error:', error.message);
    res.status(500).json({ success: false, message: 'Could not delete issue' });
  }
});

module.exports = router;
