const express = require('express');
const { body, param, validationResult } = require('express-validator');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const prisma = require('../utils/prisma');

const router = express.Router();

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

/**
 * GET /api/pricing/plans
 * Public endpoint to list all active and visible plans.
 */
router.get('/plans', async (req, res) => {
  try {
    const plans = await prisma.pricingPlan.findMany({
      where: {
        is_active: true,
        is_visible: true
      },
      orderBy: {
        display_order: 'asc'
      }
    });
    res.json({ success: true, data: plans });
  } catch (error) {
    console.error('Fetch active plans error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve active pricing plans' });
  }
});

/**
 * GET /api/pricing/admin/plans
 * Admin endpoint to list all plans.
 */
router.get('/admin/plans', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const plans = await prisma.pricingPlan.findMany({
      orderBy: {
        display_order: 'asc'
      }
    });
    res.json({ success: true, data: plans });
  } catch (error) {
    console.error('Fetch admin plans error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to retrieve all pricing plans' });
  }
});

const planValidation = [
  body('name').trim().notEmpty().withMessage('Plan name is required').isLength({ max: 100 }),
  body('slug').trim().notEmpty().withMessage('Plan slug is required').isLength({ max: 100 }),
  body('base_price').isDecimal().withMessage('Base price must be a decimal value'),
  body('included_members').isInt({ min: 0 }).withMessage('Included members must be a non-negative integer'),
  body('extra_member_price').optional().isDecimal().withMessage('Extra member price must be a decimal value'),
  body('billing_cycle').trim().notEmpty().withMessage('Billing cycle is required'),
  body('features').optional().isArray().withMessage('Features must be an array of strings'),
  body('button_text').optional().trim().isLength({ max: 50 }),
  body('theme_color').optional().trim().isLength({ max: 50 }),
  body('is_active').optional().isBoolean(),
  body('is_visible').optional().isBoolean(),
  body('display_order').optional().isInt()
];

/**
 * POST /api/pricing/admin/plans
 * Admin endpoint to create a new plan.
 */
router.post('/admin/plans', authenticateUser, requireAdmin, planValidation, async (req, res) => {
  const err = validatePayload(req, res);
  if (err) return;

  try {
    const {
      name, slug, description, badge, base_price, billing_cycle,
      included_members, extra_member_price, features, button_text,
      theme_color, icon, display_order, is_active, is_visible
    } = req.body;

    const existing = await prisma.pricingPlan.findUnique({ where: { slug } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A plan with this slug already exists' });
    }

    const plan = await prisma.pricingPlan.create({
      data: {
        name,
        slug,
        description,
        badge,
        base_price: parseFloat(base_price),
        billing_cycle,
        included_members: parseInt(included_members, 10),
        extra_member_price: parseFloat(extra_member_price || 0.00),
        features: features || [],
        button_text: button_text || 'Select Plan',
        theme_color: theme_color || 'var(--neon)',
        icon,
        display_order: parseInt(display_order || 0, 10),
        is_active: is_active !== undefined ? is_active : true,
        is_visible: is_visible !== undefined ? is_visible : true
      }
    });

    res.status(201).json({ success: true, message: 'Pricing plan created successfully', data: plan });
  } catch (error) {
    console.error('Create plan error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to create pricing plan' });
  }
});

/**
 * PUT /api/pricing/admin/plans/:id
 * Admin endpoint to update a plan.
 */
router.put('/admin/plans/:id', authenticateUser, requireAdmin, planValidation, async (req, res) => {
  const err = validatePayload(req, res);
  if (err) return;

  try {
    const planId = parseInt(req.params.id, 10);
    if (Number.isNaN(planId)) {
      return res.status(400).json({ success: false, message: 'Invalid plan ID' });
    }

    const {
      name, slug, description, badge, base_price, billing_cycle,
      included_members, extra_member_price, features, button_text,
      theme_color, icon, display_order, is_active, is_visible
    } = req.body;

    const existing = await prisma.pricingPlan.findFirst({
      where: { slug, NOT: { id: planId } }
    });
    if (existing) {
      return res.status(400).json({ success: false, message: 'A plan with this slug already exists' });
    }

    const plan = await prisma.pricingPlan.update({
      where: { id: planId },
      data: {
        name,
        slug,
        description,
        badge,
        base_price: parseFloat(base_price),
        billing_cycle,
        included_members: parseInt(included_members, 10),
        extra_member_price: parseFloat(extra_member_price || 0.00),
        features: features || [],
        button_text: button_text || 'Select Plan',
        theme_color: theme_color || 'var(--neon)',
        icon,
        display_order: parseInt(display_order || 0, 10),
        is_active: is_active !== undefined ? is_active : true,
        is_visible: is_visible !== undefined ? is_visible : true
      }
    });

    res.json({ success: true, message: 'Pricing plan updated successfully', data: plan });
  } catch (error) {
    console.error('Update plan error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to update pricing plan' });
  }
});

/**
 * DELETE /api/pricing/admin/plans/:id
 * Admin endpoint to delete a plan.
 */
router.delete('/admin/plans/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const planId = parseInt(req.params.id, 10);
    if (Number.isNaN(planId)) {
      return res.status(400).json({ success: false, message: 'Invalid plan ID' });
    }

    await prisma.pricingPlan.delete({
      where: { id: planId }
    });

    res.json({ success: true, message: 'Pricing plan deleted successfully' });
  } catch (error) {
    console.error('Delete plan error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to delete pricing plan' });
  }
});

/**
 * POST /api/pricing/admin/plans/reorder
 * Admin endpoint to reorder plans.
 */
router.post('/admin/plans/reorder', authenticateUser, requireAdmin, [
  body('orders').isArray().withMessage('Orders must be an array of objects with id and display_order')
], async (req, res) => {
  const err = validatePayload(req, res);
  if (err) return;

  try {
    const { orders } = req.body;

    const updates = orders.map(o => 
      prisma.pricingPlan.update({
        where: { id: parseInt(o.id, 10) },
        data: { display_order: parseInt(o.display_order, 10) }
      })
    );

    await prisma.$transaction(updates);

    res.json({ success: true, message: 'Pricing plans reordered successfully' });
  } catch (error) {
    console.error('Reorder plans error:', error.message);
    res.status(500).json({ success: false, message: 'Failed to reorder pricing plans' });
  }
});

module.exports = router;
