const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const { pool } = require('../config/db');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const { captureError } = require('../src/lib/sentry');
const Pusher = require('pusher');
const { cleanupExpiredDrafts } = require('../utils/cleanupDrafts');

const router = express.Router();

// Strict payment rate limiter — prevents order flooding and brute-force attacks
const paymentLimiter = createRateLimiter({
  limit: 10,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'payment',
});

// Validation helper
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

// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true
});

async function safeQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (error) {
    console.error(`[Payments DB Query Failed]: ${sql}`);
    console.error(`Error: ${error.message}`);
    captureError(error, {
      action: 'payments_database_query_failure',
      extra: { sql, params }
    });
    throw error;
  }
}

/**
 * POST /api/payments/create-order
 * Create a draft script and generate a Razorpay order
 */
const createOrderValidation = [
  body('title')
    .trim().notEmpty().withMessage('Script title is required')
    .isLength({ max: 255 }).withMessage('Title must be 255 characters or less'),
  body('genre').optional().trim().isLength({ max: 100 }),
  body('synopsis').optional().trim().isLength({ max: 5000 }),
  body('poster_url').optional().trim().isURL({ require_protocol: true }).withMessage('poster_url must be a valid URL'),
  body('work_type').optional().trim().isLength({ max: 100 }),
];

router.post('/create-order', authenticateUser, paymentLimiter, createOrderValidation, async (req, res) => {
  // Fire-and-forget. Throttled to once per 6 hours in memory.
  // Handles drafts from abandoned checkouts that never hit verify/cancel.
  cleanupExpiredDrafts().catch(err =>
    console.error('[DraftCleanup] Lazy trigger error:', err.message)
  );
  const validationError = validatePayload(req, res);
  if (validationError) return;
  try {
    const userId = req.user.id;
    const { title, genre, synopsis, poster_url, roles_needed, status, media_links, role_data, work_type, temp_path } = req.body;

    if (!title) {
      return res.status(400).json({ success: false, message: 'Script title is required' });
    }

    const userResult = await safeQuery('SELECT secondary_role FROM users WHERE id = ? LIMIT 1', [userId]);
    const isFounder = userResult && userResult[0] && userResult[0].secondary_role?.toLowerCase() === 'founder';
    
    if (isFounder) {
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

      if (process.env.PUSHER_APP_ID) {
        try {
          pusher.trigger('admin-dashboard', 'update', {
            type: 'NEW_SCRIPT',
            scriptId,
            title
          });
        } catch (pusherErr) {
          console.error('[Payments] Pusher trigger failed:', pusherErr.message);
        }
      }

      return res.json({
        success: true,
        is_founder: true,
        message: 'Script uploaded successfully as Founder bypass'
      });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    if (!keyId || !keySecret || keyId.startsWith('rzp_test_placeholder')) {
      return res.status(503).json({
        success: false,
        message: 'Payment gateway is not configured. Script was not submitted.'
      });
    }

    // 1. Create draft in script_drafts
    const draftResult = await safeQuery(
      `INSERT INTO script_drafts (
        user_id, title, genre, synopsis, poster_url, roles_needed, 
        status, media_links, role_data, work_type, temp_path, metadata, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 24 HOUR), NOW(), NOW())`,
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
        work_type || 'Script',
        temp_path || null,
        JSON.stringify({
          title,
          genre: genre || 'General',
          work_type: work_type || 'Script',
          created_from: 'payment_order'
        })
      ]
    );

    const draftId = draftResult.insertId;

    // 2. Setup Razorpay order parameters dynamically from the database
    let amountVal = 49.00;
    let currencyVal = 'INR';
    try {
      const sysConfig = await safeQuery(
        "SELECT amount, currency FROM payment_systems WHERE code = 'SCRIPT_UPLOAD' AND is_active = 1 LIMIT 1"
      );
      if (sysConfig && sysConfig.length > 0) {
        amountVal = parseFloat(sysConfig[0].amount);
        currencyVal = sysConfig[0].currency;
      }
    } catch (dbErr) {
      console.warn('[Payments] Could not query dynamic payment systems, falling back to default:', dbErr.message);
    }

    const amount = Math.round(amountVal * 100); // Convert to paise
    const currency = currencyVal;
    let orderId = '';

    try {
      const response = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
        },
        body: JSON.stringify({
          amount,
          currency,
          receipt: `draft_${draftId}`,
          notes: {
            userId: String(userId),
            draftId: String(draftId)
          }
        })
      });

      const orderData = await response.json();

      if (!response.ok || !orderData.id) {
        throw new Error(orderData.error?.description || 'Razorpay order creation failed');
      }

      orderId = orderData.id;
    } catch (razorpayError) {
      await safeQuery('DELETE FROM script_drafts WHERE id = ? AND user_id = ?', [draftId, userId]);
      console.error('[Payments] Razorpay API Error:', razorpayError.message);
      captureError(razorpayError, { action: 'razorpay_order_creation_failed', extra: { draftId, userId } });
      return res.status(502).json({
        success: false,
        message: 'PAYMENT FAILED — SCRIPT NOT SUBMITTED'
      });
    }

    // 3. Save pending payment record
    await safeQuery(
      `INSERT INTO script_upload_payments (
        user_id, draft_id, razorpay_order_id, amount, currency, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())`,
      [userId, draftId, orderId, amount / 100, currency]
    );

    res.json({
      success: true,
      order_id: orderId,
      draft_id: draftId,
      amount,
      currency,
      key_id: keyId,
      is_simulated: false
    });

  } catch (error) {
    console.error('Create order error:', error.message);
    res.status(500).json({ success: false, message: 'Could not prepare payment order' });
  }
});

/**
 * POST /api/payments/verify
 * Verify payment signature and promote script draft to scripts list
 */
const verifyPaymentValidation = [
  body('razorpay_order_id').trim().notEmpty().withMessage('razorpay_order_id is required'),
  body('razorpay_payment_id').trim().notEmpty().withMessage('razorpay_payment_id is required'),
  body('razorpay_signature').trim().notEmpty().withMessage('razorpay_signature is required'),
  body('draft_id').isInt({ min: 1 }).withMessage('draft_id must be a positive integer'),
];

router.post('/verify', authenticateUser, paymentLimiter, verifyPaymentValidation, async (req, res) => {
  const validationError = validatePayload(req, res);
  if (validationError) return;
  const connection = await pool.getConnection();
  try {
    const userId = req.user.id;
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, draft_id } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !draft_id) {
      return res.status(400).json({ success: false, message: 'Missing payment verification fields' });
    }

    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    if (!keySecret) {
      return res.status(503).json({ success: false, message: 'Payment verification is not configured' });
    }

    const generatedSignature = crypto
      .createHmac('sha256', keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex');

    if (generatedSignature !== razorpay_signature) {
      console.warn(`[Payments] Invalid signature for Order: ${razorpay_order_id}`);
      await safeQuery(
        `UPDATE script_upload_payments SET status = 'failed', razorpay_payment_id = ?, razorpay_signature = ?, updated_at = NOW()
         WHERE razorpay_order_id = ? AND user_id = ?`,
        [razorpay_payment_id, razorpay_signature, razorpay_order_id, userId]
      );
      await safeQuery('DELETE FROM script_drafts WHERE id = ? AND user_id = ?', [draft_id, userId]);
      return res.status(400).json({ success: false, message: 'PAYMENT FAILED — SCRIPT NOT SUBMITTED' });
    }

    // Start transaction to promote script safely
    await connection.beginTransaction();

    // 1. Get payment row & verify ownership
    const [payments] = await connection.query(
      'SELECT * FROM script_upload_payments WHERE razorpay_order_id = ? AND user_id = ? LIMIT 1',
      [razorpay_order_id, userId]
    );

    if (payments.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Payment transaction record not found' });
    }

    const paymentRecord = payments[0];
    if (paymentRecord.status === 'successful') {
      await connection.rollback();
      return res.status(400).json({ success: false, message: 'Payment has already been verified and processed' });
    }

    // 2. Fetch draft script
    const [drafts] = await connection.query(
      'SELECT * FROM script_drafts WHERE id = ? AND user_id = ? LIMIT 1',
      [draft_id, userId]
    );

    if (drafts.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: 'Script draft not found' });
    }

    const draft = drafts[0];

    if (draft.expires_at && new Date(draft.expires_at).getTime() < Date.now()) {
      await connection.query(
        `UPDATE script_upload_payments SET status = 'failed', updated_at = NOW() WHERE id = ?`,
        [paymentRecord.id]
      );
      await connection.query('DELETE FROM script_drafts WHERE id = ? AND user_id = ?', [draft_id, userId]);
      await connection.commit();
      return res.status(410).json({ success: false, message: 'UPLOAD CANCELLED' });
    }

    // 3. Promote draft to scripts table
    const [insertResult] = await connection.query(
      `INSERT INTO scripts (
        user_id, title, genre, synopsis, poster_url, roles_needed, 
        status, media_links, role_data, work_type, approval_status, payment_status, payment_id, payment_verified, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'paid', ?, TRUE, NOW(), NOW())`,
      [
        draft.user_id,
        draft.title,
        draft.genre,
        draft.synopsis,
        draft.poster_url,
        draft.roles_needed,
        draft.status,
        draft.media_links,
        draft.role_data,
        draft.work_type,
        razorpay_payment_id
      ]
    );

    const scriptId = insertResult.insertId;

    // 4. Update payment transaction record to successful
    await connection.query(
      `UPDATE script_upload_payments 
       SET status = 'successful', 
           razorpay_payment_id = ?, 
           razorpay_signature = ?, 
           script_id = ?, 
           updated_at = NOW() 
       WHERE id = ?`,
      [
        razorpay_payment_id,
        razorpay_signature,
        scriptId,
        paymentRecord.id
      ]
    );

    await connection.query('DELETE FROM script_drafts WHERE id = ? AND user_id = ?', [draft_id, userId]);

    await connection.commit();
    console.log(`[Payments] Verification Successful! Draft #${draft_id} promoted to Script #${scriptId}`);

    // 5. Trigger Pusher message for real-time notifications
    try {
      if (process.env.PUSHER_APP_ID) {
        pusher.trigger('admin-dashboard', 'update', {
          type: 'NEW_SCRIPT',
          scriptId,
          title: draft.title
        });
      }
    } catch (pusherErr) {
      console.error('[Payments] Pusher trigger failed:', pusherErr.message);
    }

    res.json({
      success: true,
      message: 'TRANSMISSION ACCEPTED',
      script_id: scriptId
    });

  } catch (error) {
    await connection.rollback();
    console.error('Verify payment error:', error.message);
    captureError(error, { action: 'payments_verification_failure', extra: { body: req.body } });
    res.status(500).json({ success: false, message: 'Could not complete payment verification' });
  } finally {
    connection.release();
  }
});

/**
 * POST /api/payments/cancel
 * Cancel a pending script draft after payment dismissal/failure.
 */
router.post('/cancel', authenticateUser, paymentLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { draft_id, razorpay_order_id } = req.body;

    if (!draft_id) {
      return res.status(400).json({ success: false, message: 'Missing draft id' });
    }

    await safeQuery(
      `UPDATE script_upload_payments
       SET status = 'failed', updated_at = NOW()
       WHERE draft_id = ? AND user_id = ? ${razorpay_order_id ? 'AND razorpay_order_id = ?' : ''}`,
      razorpay_order_id ? [draft_id, userId, razorpay_order_id] : [draft_id, userId]
    );
    await safeQuery('DELETE FROM script_drafts WHERE id = ? AND user_id = ?', [draft_id, userId]);

    return res.json({ success: true, message: 'UPLOAD CANCELLED' });
  } catch (error) {
    console.error('Cancel payment error:', error.message);
    return res.status(500).json({ success: false, message: 'Could not cancel upload' });
  }
});

/**
 * GET /api/payments/debug
 * Securely verify the Razorpay gateway configuration state.
 */
router.get('/debug', authenticateUser, async (req, res) => {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

    const isKeyIdConfigured = !!keyId && !keyId.startsWith('rzp_test_placeholder');
    const isKeySecretConfigured = !!keySecret && !keySecret.startsWith('rzp_test_placeholder');

    return res.json({
      success: true,
      environment: process.env.NODE_ENV || 'development',
      razorpay: {
        configured: isKeyIdConfigured && isKeySecretConfigured,
        key_id_set: isKeyIdConfigured,
        key_secret_set: isKeySecretConfigured,
        is_test_mode: keyId.includes('test')
      }
    });
  } catch (error) {
    console.error('Razorpay config debug failure:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to inspect configuration state securely.' });
  }
});

/**
 * GET /api/payments/admin/systems
 * Secure: Requires Admin. Lists all payment systems, with auto-seeding.
 */
router.get('/admin/systems', authenticateUser, requireAdmin, async (req, res) => {
  try {
    // 1. Check if empty
    const countResult = await safeQuery('SELECT COUNT(*) AS count FROM payment_systems');
    if (countResult[0].count === 0) {
      console.log('[Payments Admin] Seeding default payment system SCRIPT_UPLOAD...');
      await safeQuery(
        `INSERT INTO payment_systems (name, code, amount, currency, description, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, NOW(), NOW())`,
        [
          'Script Upload Verification',
          'SCRIPT_UPLOAD',
          49.00,
          'INR',
          'Verification fee to process and promote script submissions to public listings.'
        ]
      );
    }

    // 2. Fetch all payment systems
    const systems = await safeQuery('SELECT * FROM payment_systems ORDER BY id ASC');
    return res.json({ success: true, data: systems });
  } catch (error) {
    console.error('[Payments Admin List Error]:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to retrieve payment systems' });
  }
});

/**
 * PUT /api/payments/admin/systems/:id
 * Secure: Requires Admin. Updates the payment amount, active status, or description.
 */
router.put('/admin/systems/:id', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const systemId = Number(req.params.id);
    const { amount, is_active, description } = req.body;

    if (amount === undefined || Number.isNaN(Number(amount)) || Number(amount) < 0) {
      return res.status(400).json({ success: false, message: 'A valid amount is required' });
    }

    // Update payment system
    await safeQuery(
      `UPDATE payment_systems 
       SET amount = ?, 
           is_active = ?, 
           description = ?, 
           updated_at = NOW() 
       WHERE id = ?`,
      [
        Number(amount),
        is_active !== undefined ? (is_active ? 1 : 0) : 1,
        description || '',
        systemId
      ]
    );

    return res.json({ success: true, message: 'Payment system updated successfully' });
  } catch (error) {
    console.error('[Payments Admin Update Error]:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update payment system' });
  }
});

/**
 * GET /api/payments/admin/systems/:code/transactions
 * Secure: Requires Admin. Lists all successful transactions for a payment system.
 */
router.get('/admin/systems/:code/transactions', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const { code } = req.params;

    if (code !== 'SCRIPT_UPLOAD') {
      return res.json({ success: true, data: [] });
    }

    // Fetch transactions
    const transactions = await safeQuery(
      `SELECT 
        p.id, 
        p.amount, 
        p.currency, 
        p.razorpay_order_id,
        p.razorpay_payment_id, 
        p.status,
        p.created_at, 
        u.name AS user_name, 
        u.email AS user_email,
        COALESCE(s.title, d.title, 'Untitled Draft') AS script_title
      FROM script_upload_payments p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN scripts s ON p.script_id = s.id
      LEFT JOIN script_drafts d ON p.draft_id = d.id
      ORDER BY p.created_at DESC`
    );

    return res.json({ success: true, data: transactions });
  } catch (error) {
    console.error('[Payments Admin Transactions Error]:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to retrieve transactions' });
  }
});

module.exports = router;
