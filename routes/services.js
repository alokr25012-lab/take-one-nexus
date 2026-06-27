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
    body('advancePayment').optional().isFloat({ min: 0 }).withMessage('advancePayment must be a positive number'),
    body('timelineDays').isInt({ min: 1 }).withMessage('timelineDays must be positive'),
    body('features').isArray().withMessage('features must be an array of strings'),
    body('description').optional().trim(),
    body('annualPrice').optional().isFloat({ min: 0 }),
    body('annualDiscount').optional().isFloat({ min: 0 }),
    body('quarterlyPrice').optional().isFloat({ min: 0 }),
    body('monthlyPrice').optional().isFloat({ min: 0 }),
    body('includedServices').optional().isArray()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const {
        userId,
        websiteType,
        price,
        timelineDays,
        features,
        description,
        advancePayment,
        annualPrice,
        annualDiscount,
        quarterlyPrice,
        monthlyPrice,
        includedServices
      } = req.body;

      const priceNum = parseFloat(price);
      const advancePaymentNum = advancePayment ? parseFloat(advancePayment) : parseFloat((priceNum * 0.50).toFixed(2));
      const finalPaymentNum = parseFloat((priceNum - advancePaymentNum).toFixed(2));

      // Create the offer
      const offer = await prisma.websiteOffer.create({
        data: {
          user_id: Number(userId),
          admin_id: req.user.id,
          website_type: websiteType,
          description: description || '',
          features: features,
          price: priceNum,
          advance_payment: advancePaymentNum,
          final_payment: finalPaymentNum,
          timeline_days: Number(timelineDays),
          status: 'pending',
          annual_price: annualPrice ? parseFloat(annualPrice) : 29999,
          annual_discount: annualDiscount ? parseFloat(annualDiscount) : 0,
          quarterly_price: quarterlyPrice ? parseFloat(quarterlyPrice) : 9000,
          monthly_price: monthlyPrice ? parseFloat(monthlyPrice) : 3500,
          included_services: includedServices || ['Hosting', 'Daily Backups', 'SSL Security', 'Software Updates', 'Uptime Monitoring', 'Priority Support'],
          negotiation_history: []
        }
      });

      // Send interactive card message via the system user with updated marketing copy
      await sendSystemMessage(
        Number(userId),
        `[WEBSITE_OFFER:${offer.id}]\n\nGet a professionally developed website with a one-time development fee. Continue worry-free with optional maintenance plans covering hosting, updates, security, backups, and technical support. Choose from Annual, Quarterly, or Monthly plans based on your business needs.`
      );

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
    body('selectedMaintenancePlan').optional().isIn(['Annual', 'Quarterly', 'Monthly']),
    body('proposedBudget').optional().isFloat({ min: 0 }),
    body('proposedMaintenancePrice').optional().isFloat({ min: 0 }),
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
      const { status, selectedMaintenancePlan, proposedBudget, proposedMaintenancePrice, message, reason } = req.body;

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
        const history = offer.negotiation_history ? JSON.parse(JSON.stringify(offer.negotiation_history)) : [];
        history.push({
          by: 'client',
          proposed_price: proposedBudget ? parseFloat(proposedBudget) : null,
          proposed_maintenance_price: proposedMaintenancePrice ? parseFloat(proposedMaintenancePrice) : null,
          message: message || '',
          created_at: new Date().toISOString()
        });

        updatedOffer = await prisma.websiteOffer.update({
          where: { id: offerId },
          data: {
            status,
            negotiation_count: { increment: 1 },
            negotiation_history: history
          }
        });

        // Send user's negotiation details to the system channel
        const negotiationText = `🔄 User proposed negotiation:\n- Proposed Budget: INR ${proposedBudget || 'N/A'}\n- Proposed Maintenance: INR ${proposedMaintenancePrice || 'N/A'}\n- Message: ${message || 'N/A'}`;
        await sendSystemMessage(req.user.id, negotiationText);

      } else {
        if (status === 'accepted') {
          if (!selectedMaintenancePlan) {
            return res.status(400).json({ success: false, message: 'selectedMaintenancePlan is required to accept the proposal' });
          }

          let mPrice = 0;
          if (selectedMaintenancePlan === 'Annual') {
            mPrice = parseFloat(offer.annual_price) - parseFloat(offer.annual_discount || 0);
          } else if (selectedMaintenancePlan === 'Quarterly') {
            mPrice = parseFloat(offer.quarterly_price);
          } else if (selectedMaintenancePlan === 'Monthly') {
            mPrice = parseFloat(offer.monthly_price);
          }

          updatedOffer = await prisma.websiteOffer.update({
            where: { id: offerId },
            data: {
              status,
              selected_maintenance_plan: selectedMaintenancePlan,
              selected_maintenance_price: mPrice
            }
          });

          // Create corresponding WebsiteOrder
          const defaultMilestones = [
            { id: 1, title: 'Requirements Alignment & Contract Signing', completed: false },
            { id: 2, title: 'Wireframing & UI/UX Design Approval', completed: false },
            { id: 3, title: 'Frontend Development & Interactive Prototype', completed: false },
            { id: 4, title: 'Backend Integration & Feature Development', completed: false },
            { id: 5, title: 'Testing, Deployment & Final Handover', completed: false }
          ];

          const order = await prisma.websiteOrder.create({
            data: {
              offer_id: offerId,
              user_id: req.user.id,
              project_status: 'pending_advance',
              milestones: defaultMilestones
            }
          });

          // Pre-create the pending maintenance record
          await prisma.websiteMaintenance.create({
            data: {
              website_order_id: order.id,
              user_id: req.user.id,
              plan_type: selectedMaintenancePlan,
              custom_price: mPrice,
              status: 'pending',
              description: `Website Maintenance ${selectedMaintenancePlan} Plan`,
              included_services: offer.included_services,
              payment_history: []
            }
          });

          const totalToday = parseFloat(offer.advance_payment) + mPrice;
          await sendSystemMessage(
            req.user.id, 
            `✅ Offer Accepted!\nProject initialized.\n\nTotal Payable Today: INR ${totalToday.toLocaleString('en-IN')} (Advance: INR ${offer.advance_payment} + ${selectedMaintenancePlan} Maintenance: INR ${mPrice})\n\nPlease pay the Advance Total to start development.`
          );

          if (process.env.PUSHER_APP_ID) {
            pusher.trigger('admin-dashboard', 'notification', {
              type: 'proposal_accepted',
              title: 'Proposal Accepted',
              message: `Proposal accepted by client ${req.user.name} for offer #${offerId}`,
              offerId,
              orderId: order.id
            });
          }
        } else {
          // status === 'rejected'
          updatedOffer = await prisma.websiteOffer.update({
            where: { id: offerId },
            data: { status }
          });

          await sendSystemMessage(req.user.id, `❌ Website offer rejected by user.`);
          
          if (process.env.PUSHER_APP_ID) {
            pusher.trigger('admin-dashboard', 'notification', {
              type: 'proposal_rejected',
              title: 'Proposal Rejected',
              message: `Proposal rejected by client ${req.user.name} for offer #${offerId}`,
              offerId
            });
          }
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

// 4b. Admin Response to Counter Offer (Accept/Reject/Revised Proposal)
router.post(
  '/offers/:id/counter-response',
  authenticateUser,
  requireAdmin,
  [
    body('action').isIn(['accept', 'reject', 'revised']).withMessage('Invalid action'),
    body('price').optional().isFloat({ min: 0 }),
    body('annualPrice').optional().isFloat({ min: 0 }),
    body('quarterlyPrice').optional().isFloat({ min: 0 }),
    body('monthlyPrice').optional().isFloat({ min: 0 }),
    body('timelineDays').optional().isInt({ min: 1 }),
    body('message').optional().trim()
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const offerId = Number(req.params.id);
      const { action, price, annualPrice, quarterlyPrice, monthlyPrice, timelineDays, message } = req.body;

      const offer = await prisma.websiteOffer.findUnique({
        where: { id: offerId }
      });

      if (!offer) {
        return res.status(404).json({ success: false, message: 'Offer not found' });
      }

      const history = offer.negotiation_history ? JSON.parse(JSON.stringify(offer.negotiation_history)) : [];
      let updatedOffer;

      if (action === 'accept') {
        const lastClientRound = history.slice().reverse().find(h => h.by === 'client');
        const newPrice = lastClientRound && lastClientRound.proposed_price ? lastClientRound.proposed_price : parseFloat(offer.price);
        const newMaintPrice = lastClientRound && lastClientRound.proposed_maintenance_price ? lastClientRound.proposed_maintenance_price : null;

        const advanceNum = parseFloat((newPrice * 0.5).toFixed(2));
        const finalNum = parseFloat((newPrice - advanceNum).toFixed(2));

        history.push({
          by: 'admin',
          action: 'accepted_counter',
          price: newPrice,
          maintenance_price: newMaintPrice,
          message: message || 'Counter offer accepted.',
          created_at: new Date().toISOString()
        });

        updatedOffer = await prisma.websiteOffer.update({
          where: { id: offerId },
          data: {
            status: 'pending',
            price: newPrice,
            advance_payment: advanceNum,
            final_payment: finalNum,
            selected_maintenance_price: newMaintPrice,
            // also update the plan prices so the selection matches the negotiated value
            annual_price: newMaintPrice || offer.annual_price,
            quarterly_price: newMaintPrice || offer.quarterly_price,
            monthly_price: newMaintPrice || offer.monthly_price,
            negotiation_history: history
          }
        });

        await sendSystemMessage(
          offer.user_id,
          `🔄 Admin accepted your counter offer!\nThe proposal has been updated.\n- Development Fee: INR ${newPrice}\n- Maintenance Price: INR ${newMaintPrice || 'N/A'}\n\nPlease review and accept the proposal.`
        );

      } else if (action === 'reject') {
        history.push({
          by: 'admin',
          action: 'rejected_counter',
          message: message || 'Counter offer rejected.',
          created_at: new Date().toISOString()
        });

        updatedOffer = await prisma.websiteOffer.update({
          where: { id: offerId },
          data: {
            status: 'rejected',
            negotiation_history: history
          }
        });

        await sendSystemMessage(offer.user_id, `❌ Admin rejected the counter offer. The proposal has been closed.`);

      } else {
        // action === 'revised'
        const newPrice = price ? parseFloat(price) : parseFloat(offer.price);
        const advanceNum = parseFloat((newPrice * 0.5).toFixed(2));
        const finalNum = parseFloat((newPrice - advanceNum).toFixed(2));

        history.push({
          by: 'admin',
          action: 'revised',
          price: newPrice,
          annual_price: annualPrice ? parseFloat(annualPrice) : parseFloat(offer.annual_price || 0),
          message: message || 'Admin sent a revised proposal.',
          created_at: new Date().toISOString()
        });

        updatedOffer = await prisma.websiteOffer.update({
          where: { id: offerId },
          data: {
            status: 'pending',
            price: newPrice,
            advance_payment: advanceNum,
            final_payment: finalNum,
            annual_price: annualPrice ? parseFloat(annualPrice) : offer.annual_price,
            quarterly_price: quarterlyPrice ? parseFloat(quarterlyPrice) : offer.quarterly_price,
            monthly_price: monthlyPrice ? parseFloat(monthlyPrice) : offer.monthly_price,
            timeline_days: timelineDays ? Number(timelineDays) : offer.timeline_days,
            negotiation_history: history
          }
        });

        await sendSystemMessage(
          offer.user_id,
          `🔄 Admin sent a revised proposal.\n- New Development Fee: INR ${newPrice}\n- Message: ${message || 'N/A'}\n\nPlease review the updated terms.`
        );
      }

      if (process.env.PUSHER_APP_ID) {
        pusher.trigger(`user-${offer.user_id}`, 'offer-update', updatedOffer);
        pusher.trigger('admin-dashboard', 'update', { type: 'offer_status_change', id: offerId });
      }

      res.json({ success: true, data: updatedOffer });
    } catch (err) {
      console.error('[Services API] Error responding to counter offer:', err);
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
        // First Payment = Advance Development Payment + Selected Maintenance Plan Price
        const advanceFee = parseFloat(order.offer.advance_payment);
        const maintenanceFee = parseFloat(order.offer.selected_maintenance_price || 0);
        amount = advanceFee + maintenanceFee;
      } else {
        if (!order.advance_paid) {
          return res.status(400).json({ success: false, message: 'Advance payment must be paid first' });
        }
        if (order.final_paid) {
          return res.status(400).json({ success: false, message: 'Final balance already paid' });
        }
        // Second Payment = Final Development Amount only
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
            project_status: order.offer.website_type === 'Maintenance Renewal' ? 'completed' : 'in_progress'
          }
        });

        // Activate or renew the maintenance subscription
        if (order.offer.website_type === 'Maintenance Renewal') {
          // Find the client's previous maintenance subscription for the website to extend
          const prevMaintenance = await prisma.websiteMaintenance.findFirst({
            where: {
              user_id: order.user_id,
              website_order_id: { not: order.id }
            },
            orderBy: { created_at: 'desc' }
          });

          if (prevMaintenance) {
            const startDate = (prevMaintenance.expiry_date && new Date(prevMaintenance.expiry_date) > new Date())
              ? new Date(prevMaintenance.expiry_date)
              : new Date();
            
            let expiryDate = new Date(startDate);
            if (order.offer.selected_maintenance_plan === 'Annual') {
              expiryDate.setFullYear(startDate.getFullYear() + 1);
            } else if (order.offer.selected_maintenance_plan === 'Quarterly') {
              expiryDate.setMonth(startDate.getMonth() + 3);
            } else if (order.offer.selected_maintenance_plan === 'Monthly') {
              expiryDate.setMonth(startDate.getMonth() + 1);
            }

            const paymentHistory = prevMaintenance.payment_history ? JSON.parse(JSON.stringify(prevMaintenance.payment_history)) : [];
            paymentHistory.push({
              type: 'renewal',
              date: new Date().toISOString(),
              amount: parseFloat(order.offer.selected_maintenance_price || 0),
              receipt: `receipt_renewal_${order.id}_${Date.now()}`,
              razorpay_order_id,
              razorpay_payment_id
            });

            await prisma.websiteMaintenance.update({
              where: { id: prevMaintenance.id },
              data: {
                status: 'active',
                expiry_date: expiryDate,
                renewal_date: expiryDate,
                payment_history: paymentHistory
              }
            });

            await sendSystemMessage(
              order.user_id,
              `🔁 Maintenance plan renewed successfully!\nNew Expiry Date: ${expiryDate.toLocaleDateString('en-US')}`
            );
          }
        } else {
          // Standard proposal: activate the pending maintenance record
          const maintenance = await prisma.websiteMaintenance.findFirst({
            where: { website_order_id: order.id, status: 'pending' }
          });

          if (maintenance) {
            const startDate = new Date();
            let expiryDate = new Date();
            if (maintenance.plan_type === 'Annual') {
              expiryDate.setFullYear(startDate.getFullYear() + 1);
            } else if (maintenance.plan_type === 'Quarterly') {
              expiryDate.setMonth(startDate.getMonth() + 3);
            } else if (maintenance.plan_type === 'Monthly') {
              expiryDate.setMonth(startDate.getMonth() + 1);
            }

            const paymentHistory = [];
            paymentHistory.push({
              type: 'purchase',
              date: new Date().toISOString(),
              amount: parseFloat(order.offer.selected_maintenance_price || 0),
              receipt: `receipt_maint_${order.id}_${Date.now()}`,
              razorpay_order_id,
              razorpay_payment_id
            });

            await prisma.websiteMaintenance.update({
              where: { id: maintenance.id },
              data: {
                status: 'active',
                start_date: startDate,
                expiry_date: expiryDate,
                renewal_date: expiryDate,
                payment_history: paymentHistory
              }
            });
          }

          await sendSystemMessage(
            order.user_id, 
            `💳 Advance payment verified successfully!\nProject status: In Development.\nYou can track progress directly in your Project Dashboard.\n\nMaintenance subscription activated successfully:\n- Plan: ${order.offer.selected_maintenance_plan}\n- Price: INR ${order.offer.selected_maintenance_price}`
          );
        }

        if (process.env.PUSHER_APP_ID) {
          pusher.trigger('admin-dashboard', 'notification', {
            type: 'advance_payment_received',
            title: 'Advance Payment Received',
            message: `Advance payment of INR ${order.offer.advance_payment} received from client for project #${order.id}`,
            orderId: order.id
          });
        }
      } else if (order.razorpay_order_id_final === razorpay_order_id) {
        updatedOrder = await prisma.websiteOrder.update({
          where: { id: order.id },
          data: {
            final_paid: true,
            razorpay_payment_id_final: razorpay_payment_id,
            project_status: 'completed'
          }
        });
        await sendSystemMessage(
          order.user_id, 
          `🎉 Final payment verified successfully!\nProject completed successfully. Thank you for choosing Take One services!\n\nGet a professionally developed website with a one-time development fee. Continue worry-free with optional maintenance plans covering hosting, updates, security, backups, and technical support. Choose from Annual, Quarterly, or Monthly plans based on your business needs.`
        );

        if (process.env.PUSHER_APP_ID) {
          pusher.trigger('admin-dashboard', 'notification', {
            type: 'final_payment_received',
            title: 'Final Payment Received',
            message: `Final payment of INR ${order.offer.final_payment} received from client for project #${order.id}. Project marked completed!`,
            orderId: order.id
          });
        }
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
        } else if (projectStatus === 'completed') {
          msg = `🎉 Website Completed!\nYour website has been successfully developed, approved, and delivered. Thank you for choosing Take One!\n\nGet a professionally developed website with a one-time development fee. Continue worry-free with an optional annual maintenance plan covering hosting, updates, security, backups, and technical support.`;
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

// 9. Fetch Maintenance list
router.get('/maintenance', authenticateUser, async (req, res) => {
  try {
    const isAdmin = ['admin', 'founder'].includes(req.user.secondary_role);
    let maintenance;
    if (isAdmin) {
      maintenance = await prisma.websiteMaintenance.findMany({
        orderBy: { created_at: 'desc' },
        include: {
          user: { select: { id: true, name: true, email: true } },
          order: { include: { offer: true } }
        }
      });
    } else {
      maintenance = await prisma.websiteMaintenance.findMany({
        where: { user_id: req.user.id },
        orderBy: { created_at: 'desc' },
        include: {
          order: { include: { offer: true } }
        }
      });
    }
    res.json({ success: true, data: maintenance });
  } catch (err) {
    console.error('[Services API] Error fetching maintenance records:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// 10. Fetch Single Maintenance details
router.get('/maintenance/:id', authenticateUser, async (req, res) => {
  try {
    const mId = Number(req.params.id);
    const maintenance = await prisma.websiteMaintenance.findUnique({
      where: { id: mId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        order: { include: { offer: true } }
      }
    });
    if (!maintenance) {
      return res.status(404).json({ success: false, message: 'Maintenance record not found' });
    }
    const isAdmin = ['admin', 'founder'].includes(req.user.secondary_role);
    if (!isAdmin && maintenance.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    res.json({ success: true, data: maintenance });
  } catch (err) {
    console.error('[Services API] Error fetching maintenance record:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

// 11. Create Maintenance Offer (Admin only)
router.post(
  '/maintenance/offer',
  authenticateUser,
  requireAdmin,
  [
    body('orderId').isInt().withMessage('orderId is required'),
    body('annualPrice').isFloat({ min: 0 }).withMessage('annualPrice is required'),
    body('description').optional().trim(),
    body('includedServices').isArray().withMessage('includedServices is required')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { orderId, annualPrice, description, includedServices } = req.body;
      const order = await prisma.websiteOrder.findUnique({
        where: { id: Number(orderId) }
      });
      if (!order) {
        return res.status(404).json({ success: false, message: 'Order not found' });
      }

      const maintenance = await prisma.websiteMaintenance.create({
        data: {
          website_order_id: Number(orderId),
          user_id: order.user_id,
          annual_price: parseFloat(annualPrice),
          description: description || '',
          included_services: includedServices,
          status: 'pending',
          payment_history: []
        }
      });

      // Send proposal card in chat
      await sendSystemMessage(
        order.user_id,
        `[MAINTENANCE_OFFER:${maintenance.id}]\n\nGet a professionally developed website with a one-time development fee. Continue worry-free with an optional annual maintenance plan covering hosting, updates, security, backups, and technical support.`
      );

      if (process.env.PUSHER_APP_ID) {
        pusher.trigger(`user-${order.user_id}`, 'maintenance-offer', maintenance);
        pusher.trigger('admin-dashboard', 'update', { type: 'maintenance_offered', id: maintenance.id });
      }

      res.status(201).json({ success: true, data: maintenance });
    } catch (err) {
      console.error('[Services API] Error offering maintenance:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

// 12. Respond to Maintenance Offer (User only, e.g. "Maybe Later")
router.post(
  '/maintenance/:id/respond',
  authenticateUser,
  [
    body('status').isIn(['declined']).withMessage('Invalid status')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const mId = Number(req.params.id);
      const { status } = req.body;
      const maintenance = await prisma.websiteMaintenance.findUnique({
        where: { id: mId }
      });
      if (!maintenance) {
        return res.status(404).json({ success: false, message: 'Maintenance record not found' });
      }
      if (maintenance.user_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }

      const updated = await prisma.websiteMaintenance.update({
        where: { id: mId },
        data: { status }
      });

      await sendSystemMessage(req.user.id, `🔄 Annual maintenance proposal response: Client selected 'Maybe Later'. You can purchase this plan at any time from your project dashboard.`);

      if (process.env.PUSHER_APP_ID) {
        pusher.trigger(`user-${req.user.id}`, 'maintenance-update', updated);
        pusher.trigger('admin-dashboard', 'update', { type: 'maintenance_declined', id: mId });
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('[Services API] Error updating maintenance response:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

// 13. Pay Annual Maintenance (User only)
router.post('/maintenance/:id/pay', authenticateUser, async (req, res) => {
  try {
    const mId = Number(req.params.id);
    const maintenance = await prisma.websiteMaintenance.findUnique({
      where: { id: mId }
    });
    if (!maintenance) {
      return res.status(404).json({ success: false, message: 'Maintenance record not found' });
    }
    if (maintenance.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    const amount = parseFloat(maintenance.annual_price);

    const rpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // in paise
        currency: 'INR',
        receipt: `receipt_maintenance_${maintenance.id}`,
        notes: {
          userId: String(req.user.id),
          maintenanceId: String(maintenance.id),
          action: 'purchase'
        }
      })
    });

    const rpOrderData = await rpResponse.json();
    if (!rpResponse.ok) {
      throw new Error(rpOrderData.error?.description || 'Razorpay order creation failed');
    }

    res.json({
      success: true,
      keyId: keyId,
      orderId: rpOrderData.id,
      amount: rpOrderData.amount,
      currency: rpOrderData.currency
    });
  } catch (err) {
    console.error('[Services API] Error creating maintenance payment order:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
});

// 14. Renew Annual Maintenance (User only)
router.post('/maintenance/:id/renew', authenticateUser, async (req, res) => {
  try {
    const mId = Number(req.params.id);
    const maintenance = await prisma.websiteMaintenance.findUnique({
      where: { id: mId }
    });
    if (!maintenance) {
      return res.status(404).json({ success: false, message: 'Maintenance record not found' });
    }
    if (maintenance.user_id !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }

    const keyId = process.env.RAZORPAY_KEY_ID || '';
    const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
    const amount = parseFloat(maintenance.annual_price);

    const rpResponse = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(keyId + ':' + keySecret).toString('base64'),
      },
      body: JSON.stringify({
        amount: Math.round(amount * 100), // in paise
        currency: 'INR',
        receipt: `receipt_maintenance_renewal_${maintenance.id}`,
        notes: {
          userId: String(req.user.id),
          maintenanceId: String(maintenance.id),
          action: 'renewal'
        }
      })
    });

    const rpOrderData = await rpResponse.json();
    if (!rpResponse.ok) {
      throw new Error(rpOrderData.error?.description || 'Razorpay order creation failed');
    }

    res.json({
      success: true,
      keyId: keyId,
      orderId: rpOrderData.id,
      amount: rpOrderData.amount,
      currency: rpOrderData.currency
    });
  } catch (err) {
    console.error('[Services API] Error creating maintenance renewal payment order:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal Server Error' });
  }
});

// 15. Verify Maintenance Payment (Purchase/Renewal)
router.post(
  '/maintenance/verify-payment',
  authenticateUser,
  [
    body('razorpay_order_id').trim().notEmpty(),
    body('razorpay_payment_id').trim().notEmpty(),
    body('razorpay_signature').trim().notEmpty(),
    body('maintenanceId').isInt(),
    body('action').isIn(['purchase', 'renewal'])
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }
    try {
      const { razorpay_order_id, razorpay_payment_id, razorpay_signature, maintenanceId, action } = req.body;
      const keySecret = process.env.RAZORPAY_KEY_SECRET || '';
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        return res.status(400).json({ success: false, message: 'Invalid payment signature' });
      }

      const maintenance = await prisma.websiteMaintenance.findUnique({
        where: { id: Number(maintenanceId) }
      });
      if (!maintenance) {
        return res.status(404).json({ success: false, message: 'Maintenance record not found' });
      }

      // Calculate dates
      let startDate = new Date();
      if (action === 'renewal' && maintenance.expiry_date && new Date(maintenance.expiry_date) > new Date()) {
        startDate = new Date(maintenance.expiry_date);
      }
      const expiryDate = new Date(startDate.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year duration

      const paymentHistory = maintenance.payment_history ? JSON.parse(JSON.stringify(maintenance.payment_history)) : [];
      paymentHistory.push({
        type: action,
        date: new Date().toISOString(),
        amount: Number(maintenance.annual_price),
        receipt: `receipt_maintenance_${action}_${maintenance.id}_${Date.now()}`,
        razorpay_order_id,
        razorpay_payment_id
      });

      const updated = await prisma.websiteMaintenance.update({
        where: { id: maintenance.id },
        data: {
          status: 'active',
          start_date: action === 'purchase' ? new Date() : maintenance.start_date,
          expiry_date: expiryDate,
          renewal_date: action === 'renewal' ? new Date() : maintenance.renewal_date,
          payment_history: paymentHistory
        }
      });

      const msg = action === 'purchase'
        ? `🎉 Annual Maintenance Plan purchased successfully!\nYour website is now secure, hosted, and monitored. Start Date: ${updated.start_date.toLocaleDateString()}, Expiry Date: ${updated.expiry_date.toLocaleDateString()}.`
        : `🔁 Annual Maintenance Plan renewed successfully!\nNew Expiry Date: ${updated.expiry_date.toLocaleDateString()}.`;

      await sendSystemMessage(maintenance.user_id, msg);

      if (process.env.PUSHER_APP_ID) {
        pusher.trigger(`user-${maintenance.user_id}`, 'maintenance-update', updated);
        pusher.trigger('admin-dashboard', 'update', { type: 'maintenance_payment_verified', id: maintenance.id });
        pusher.trigger('admin-dashboard', 'notification', {
          type: action === 'purchase' ? 'maintenance_purchased' : 'maintenance_renewed',
          title: action === 'purchase' ? 'Maintenance Purchased' : 'Maintenance Renewed',
          message: `Annual maintenance plan ${action === 'purchase' ? 'purchased' : 'renewed'} by client for project #${maintenance.website_order_id}`,
          maintenanceId: maintenance.id
        });
      }

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('[Services API] Error verifying maintenance payment:', err);
      res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
  }
);

// 16. Check Maintenance Expiries (triggered by scheduler or admin)
router.get('/maintenance/check-expiries', async (req, res) => {
  try {
    const activeMaintenances = await prisma.websiteMaintenance.findMany({
      where: { status: 'active' },
      include: {
        website_order: {
          include: {
            offer: true
          }
        }
      }
    });

    const notificationsSent = [];

    for (const m of activeMaintenances) {
      if (!m.expiry_date) continue;
      
      const expiry = new Date(m.expiry_date);
      const today = new Date();
      const diffMs = expiry - today;
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

      let shouldNotify = false;
      if (m.plan_type === 'Annual' && diffDays === 30) {
        shouldNotify = true;
      } else if (m.plan_type === 'Quarterly' && diffDays === 14) {
        shouldNotify = true;
      } else if (m.plan_type === 'Monthly' && diffDays === 7) {
        shouldNotify = true;
      }

      if (shouldNotify) {
        // Send a renewal proposal through Take One chat
        // Check if there is already a pending renewal offer to avoid duplicates
        const existingRenewalOffer = await prisma.websiteOffer.findFirst({
          where: {
            user_id: m.user_id,
            website_type: 'Maintenance Renewal',
            status: 'pending'
          }
        });

        if (!existingRenewalOffer) {
          const renewalOffer = await prisma.websiteOffer.create({
            data: {
              user_id: m.user_id,
              admin_id: m.website_order?.offer?.admin_id || 1, // fallback to admin ID 1
              website_type: 'Maintenance Renewal',
              description: `Website Maintenance Renewal for project #${m.website_order_id}`,
              price: 0,
              advance_payment: 0,
              final_payment: 0,
              timeline_days: 0,
              status: 'pending',
              selected_maintenance_plan: m.plan_type,
              selected_maintenance_price: m.custom_price,
              annual_price: m.plan_type === 'Annual' ? m.custom_price : (m.custom_price * 12),
              quarterly_price: m.plan_type === 'Quarterly' ? m.custom_price : (m.custom_price / 4),
              monthly_price: m.plan_type === 'Monthly' ? m.custom_price : (m.custom_price / 12),
              included_services: m.included_services,
              negotiation_history: []
            }
          });

          await sendSystemMessage(
            m.user_id,
            `⚠️ Your website maintenance subscription (${m.plan_type}) will expire in ${diffDays} days on ${expiry.toLocaleDateString('en-US')}.\n\nWe have generated a renewal offer for you below. Please review, select your desired renewal plan, and accept it to avoid service interruption:\n\n[WEBSITE_OFFER:${renewalOffer.id}]`
          );

          notificationsSent.push({
            maintenanceId: m.id,
            userId: m.user_id,
            daysRemaining: diffDays,
            renewalOfferId: renewalOffer.id
          });
        }
      }
    }

    res.json({ success: true, count: notificationsSent.length, details: notificationsSent });
  } catch (err) {
    console.error('[Services API] Error checking maintenance expiries:', err);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
});

module.exports = router;
