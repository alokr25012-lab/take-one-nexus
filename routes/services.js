const express = require('express');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { body, param, validationResult } = require('express-validator');
const prisma = require('../utils/prisma');
const Pusher = require('pusher');
const crypto = require('crypto');

const router = express.Router();

// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true
});

// Helper to get or create system user
async function getOrCreateSystemUser() {
  let systemUser = await prisma.user.findFirst({
    where: { email: 'system@takeone-nexus.net.in' }
  });
  if (!systemUser) {
    systemUser = await prisma.user.create({
      data: {
        name: 'Take One',
        email: 'system@takeone-nexus.net.in',
        password: crypto.randomBytes(32).toString('hex'),
        role: 'system',
        secondary_role: 'founder',
        email_verified: true
      }
    });
  }
  return systemUser;
}

// Helper to send a message from the system account
async function sendSystemMessage(userId, content) {
  const systemUser = await getOrCreateSystemUser();

  const existingConversations = await prisma.conversation.findMany({
    where: {
      is_group: false,
      members: {
        some: { user_id: systemUser.id }
      }
    },
    include: {
      members: true
    }
  });

  let targetConversationId;
  const match = existingConversations.find(c => c.members.some(m => m.user_id === userId));
  if (match) {
    targetConversationId = match.id;
  } else {
    const newConversation = await prisma.conversation.create({
      data: {
        is_group: false,
        members: {
          create: [
            { user_id: systemUser.id, role: 'Admin' },
            { user_id: userId, role: 'Member' }
          ]
        }
      }
    });
    targetConversationId = newConversation.id;
  }

  const message = await prisma.message.create({
    data: {
      conversation_id: targetConversationId,
      sender_id: systemUser.id,
      content: content.trim()
    },
    include: {
      sender: {
        select: {
          id: true,
          name: true,
          avatar_url: true,
          gender: true,
          role: true
        }
      }
    }
  });

  await prisma.conversation.update({
    where: { id: targetConversationId },
    data: { updated_at: new Date() }
  });

  if (process.env.PUSHER_APP_ID) {
    pusher.trigger(`conversation-${targetConversationId}`, 'new-message', {
      ...message,
      sender: message.sender
    });

    pusher.trigger(`user-${userId}`, 'message-notification', {
      conversationId: targetConversationId,
      message
    });
  }

  return message;
}

// 1. Create a Website Offer (Admin only)
router.post(
  '/offers',
  authenticateUser,
  requireAdmin,
  [
    body('userId').isInt().withMessage('userId must be an integer'),
    body('websiteType').trim().notEmpty().withMessage('websiteType is required'),
    body('price').isFloat({ min: 0 }).withMessage('price must be a positive number'),
    body('timelineDays').isInt({ min: 1 }).withMessage('timelineDays must be positive'),
    body('features').isArray().withMessage('features must be an array of strings'),
    body('description').optional().trim()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { userId, websiteType, price, timelineDays, features, description } = req.body;

      // Calculate payments (50% advance, 50% final)
      const priceNum = parseFloat(price);
      const advancePayment = parseFloat((priceNum * 0.50).toFixed(2));
      const finalPayment = parseFloat((priceNum * 0.50).toFixed(2));

      // Create the offer
      const offer = await prisma.websiteOffer.create({
        data: {
          user_id: Number(userId),
          admin_id: req.user.id,
          website_type: websiteType,
          description: description || '',
          features: features,
          price: priceNum,
          advance_payment: advancePayment,
          final_payment: finalPayment,
          timeline_days: Number(timelineDays),
          status: 'pending'
        }
      });

      // Send interactive card message via the system user
      await sendSystemMessage(Number(userId), `[WEBSITE_OFFER:${offer.id}]`);

      res.status(201).json({ success: true, data: offer });
    } catch (err) {
      console.error('[Services API] Error creating offer:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

// 2. Get All Offers (Admin gets all, user gets their own)
router.get('/offers', authenticateUser, async (req, res) => {
  try {
    const isAdmin = ['admin', 'founder'].includes(req.user.secondary_role);
    let offers;
    if (isAdmin) {
      offers = await prisma.websiteOffer.findMany({
        orderBy: { created_at: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          admin: { select: { id: true, name: true } }
        }
      });
    } else {
      offers = await prisma.websiteOffer.findMany({
        where: { user_id: req.user.id },
        orderBy: { created_at: 'desc' },
        include: {
          admin: { select: { id: true, name: true } }
        }
      });
    }
    res.json({ success: true, data: offers });
  } catch (err) {
    console.error('[Services API] Error fetching offers:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// 3. Get Specific Offer
router.get('/offers/:id', authenticateUser, async (req, res) => {
  try {
    const offerId = Number(req.params.id);
    const offer = await prisma.websiteOffer.findUnique({
      where: { id: offerId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        admin: { select: { id: true, name: true } }
      }
    });

    if (!offer) {
      return res.status(404).json({ success: false, message: 'Offer not found' });
    }

    const isAdmin = ['admin', 'founder'].includes(req.user.secondary_role);
    if (!isAdmin && offer.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    res.json({ success: true, data: offer });
  } catch (err) {
    console.error('[Services API] Error fetching offer:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// 4. Update Offer Status (Accept/Reject/Negotiate)
router.patch(
  '/offers/:id/status',
  authenticateUser,
  [
    body('status').isIn(['accepted', 'rejected', 'negotiating']).withMessage('Invalid status'),
    body('proposedBudget').optional().isFloat({ min: 0 }),
    body('message').optional().trim(),
    body('reason').optional().trim()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const offerId = Number(req.params.id);
      const { status, proposedBudget, message, reason } = req.body;

      const offer = await prisma.websiteOffer.findUnique({
        where: { id: offerId }
      });

      if (!offer) {
        return res.status(404).json({ success: false, message: 'Offer not found' });
      }

      if (offer.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      let updatedOffer;
      if (status === 'negotiating') {
        updatedOffer = await prisma.websiteOffer.update({
          where: { id: offerId },
          data: {
            status,
            negotiation_count: { increment: 1 }
          }
        });

        // Send user's negotiation details to the system channel
        const negotiationText = `🔄 User proposed negotiation:\n- Proposed Budget: INR ${proposedBudget || 'N/A'}\n- Message: ${message || 'N/A'}\n- Reason: ${reason || 'N/A'}`;
        await sendSystemMessage(req.user.id, negotiationText);

      } else {
        updatedOffer = await prisma.websiteOffer.update({
          where: { id: offerId },
          data: { status }
        });

        if (status === 'accepted') {
          // Create corresponding WebsiteOrder
          const defaultMilestones = [
            { id: 1, title: 'Requirements Alignment & Contract Signing', completed: false },
            { id: 2, title: 'Wireframing & UI/UX Design Approval', completed: false },
            { id: 3, title: 'Frontend Development & Interactive Prototype', completed: false },
            { id: 4, title: 'Backend Integration & Feature Development', completed: false },
            { id: 5, title: 'Testing, Deployment & Final Handover', completed: false }
          ];

          await prisma.websiteOrder.create({
            data: {
              offer_id: offerId,
              user_id: req.user.id,
              project_status: 'pending_advance',
              milestones: defaultMilestones
            }
          });

          await sendSystemMessage(req.user.id, `✅ Offer Accepted!\nProject initialized. Next step: Please pay the Advance Payment of INR ${offer.advance_payment} to start development.`);
        } else if (status === 'rejected') {
          await sendSystemMessage(req.user.id, `❌ Website offer rejected by user.`);
        }
      }

      // Notify clients of offer updates
      if (process.env.PUSHER_APP_ID) {
        pusher.trigger('admin-dashboard', 'update', { type: 'offer_status_change', id: offerId });
      }

      res.json({ success: true, data: updatedOffer });
    } catch (err) {
      console.error('[Services API] Error updating status:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

// 5. Create Razorpay Payment Order (Advance / Final)
router.post(
  '/orders/create-payment',
  authenticateUser,
  [
    body('orderId').isInt().withMessage('orderId must be an integer'),
    body('stage').isIn(['advance', 'final']).withMessage('stage must be advance or final')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { orderId, stage } = req.body;
      const order = await prisma.websiteOrder.findUnique({
        where: { id: Number(orderId) },
        include: { offer: true }
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      if (order.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      let amount = 0;
      if (stage === 'advance') {
        if (order.advance_paid) {
          return res.status(400).json({ success: false, message: 'Advance already paid' });
        }
        amount = parseFloat(order.offer.advance_payment);
      } else {
        if (!order.advance_paid) {
          return res.status(400).json({ success: false, message: 'Advance payment must be paid first' });
        }
        if (order.final_paid) {
          return res.status(400).json({ success: false, message: 'Final balance already paid' });
        }
        amount = parseFloat(order.offer.final_payment);
      }

      const keyId = process.env.RAZORPAY_KEY_ID || '';
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';

      const rpResponse = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
        },
        body: JSON.stringify({
          amount: Math.round(amount * 100), // in paise
          currency: 'INR',
          receipt: `receipt_weborder_${order.id}_${stage}`,
          notes: {
            userId: String(req.user.id),
            orderId: String(order.id),
            stage: stage
          }
        })
      });

      const rpOrderData = await rpResponse.json();
      if (!rpResponse.ok) {
        throw new Error(rpOrderData.error?.description || 'Razorpay order creation failed');
      }

      // Save order id to db
      if (stage === 'advance') {
        await prisma.websiteOrder.update({
          where: { id: order.id },
          data: { razorpay_order_id_advance: rpOrderData.id }
        });
      } else {
        await prisma.websiteOrder.update({
          where: { id: order.id },
          data: { razorpay_order_id_final: rpOrderData.id }
        });
      }

      res.json({
        success: true,
        keyId: keyId,
        orderId: rpOrderData.id,
        amount: rpOrderData.amount,
        currency: rpOrderData.currency
      });
    } catch (err) {
      console.error('[Services API] Error creating payment:', err);
      res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
    }
  }
);

// 6. Verify Razorpay Payment Signature
router.post(
  '/orders/verify-payment',
  authenticateUser,
  [
    body('razorpay_order_id').trim().notEmpty(),
    body('razorpay_payment_id').trim().notEmpty(),
    body('razorpay_signature').trim().notEmpty(),
    body('orderId').isInt()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderId } = req.body;

      // Verify signature
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature' });
      }

      const order = await prisma.websiteOrder.findUnique({
        where: { id: Number(orderId) },
        include: { offer: true }
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      let updatedOrder;
      if (order.razorpay_order_id_advance === razorpay_order_id) {
        updatedOrder = await prisma.websiteOrder.update({
          where: { id: order.id },
          data: {
            advance_paid: true,
            razorpay_payment_id_advance: razorpay_payment_id,
            project_status: 'in_progress'
          }
        });
        await sendSystemMessage(order.user_id, `💳 Advance payment verified successfully!\nProject status: In Development.\nYou can track progress directly in your Project Dashboard.`);
      } else if (order.razorpay_order_id_final === razorpay_order_id) {
        updatedOrder = await prisma.websiteOrder.update({
          where: { id: order.id },
          data: {
            final_paid: true,
            razorpay_payment_id_final: razorpay_payment_id,
            project_status: 'completed'
          }
        });
        await sendSystemMessage(order.user_id, `🎉 Final payment verified successfully!\nProject completed successfully. Thank you for choosing Take One services!`);
      } else {
        return res.status(400).json({ success: false, message: 'Razorpay order ID mismatch' });
      }

      if (process.env.PUSHER_APP_ID) {
        pusher.trigger('admin-dashboard', 'update', { type: 'payment_verified', orderId: order.id });
        pusher.trigger(`conversation-order-${order.id}`, 'order-update', updatedOrder);
        pusher.trigger(`user-${order.user_id}`, 'order-update', {
          orderId: order.id,
          project_status: updatedOrder.project_status,
          milestones: updatedOrder.milestones
        });
      }

      res.json({ success: true, data: updatedOrder });
    } catch (err) {
      console.error('[Services API] Error verifying payment:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

// 7. Get Active orders (User gets their own, admin gets all)
router.get('/orders', authenticateUser, async (req, res) => {
  try {
    const isAdmin = ['admin', 'founder'].includes(req.user.secondary_role);
    let orders;
    if (isAdmin) {
      orders = await prisma.websiteOrder.findMany({
        orderBy: { created_at: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          offer: true
        }
      });
    } else {
      orders = await prisma.websiteOrder.findMany({
        where: { user_id: req.user.id },
        orderBy: { created_at: 'desc' },
        include: {
          offer: true
        }
      });
    }
    res.json({ success: true, data: orders });
  } catch (err) {
    console.error('[Services API] Error fetching orders:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// 8. Update Milestone / Project Status (Admin only)
router.patch(
  '/orders/:id/milestones',
  authenticateUser,
  requireAdmin,
  [
    body('projectStatus').optional().isString(),
    body('milestones').optional().isArray()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const orderId = Number(req.params.id);
      const { projectStatus, milestones } = req.body;

      const order = await prisma.websiteOrder.findUnique({
        where: { id: orderId }
      });

      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const updateData = {};
      if (projectStatus) updateData.project_status = projectStatus;
      if (milestones) updateData.milestones = milestones;

      const updatedOrder = await prisma.websiteOrder.update({
        where: { id: orderId },
        data: updateData,
        include: { offer: true }
      });

      // Send notification message to user on state changes
      if (projectStatus && projectStatus !== order.project_status) {
        let msg = `⚙️ Project milestone update! Current project status has been updated to: **${projectStatus.toUpperCase().replace(/_/g, ' ')}**`;
        if (projectStatus === 'pending_final_payment') {
          msg = `🔔 Handover stage reached! Please clear the Final Payment of INR ${updatedOrder.offer.final_payment} to download source files and complete delivery.`;
        }
        await sendSystemMessage(order.user_id, msg);
      }

      if (process.env.PUSHER_APP_ID) {
        pusher.trigger(`conversation-order-${order.id}`, 'order-update', updatedOrder);
        pusher.trigger(`user-${order.user_id}`, 'order-update', {
          orderId: order.id,
          project_status: updatedOrder.project_status,
          milestones: updatedOrder.milestones
        });
      }

      res.json({ success: true, data: updatedOrder });
    } catch (err) {
      console.error('[Services API] Error updating milestones:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

module.exports = router;
