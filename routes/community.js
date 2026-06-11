const express = require('express');
const { authenticateUser, requireAdmin } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middleware/validator');
const prisma = require('../utils/prisma');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { captureError } = require('../src/lib/sentry');
const { uploadLogo } = require('../middleware/upload');
const { createRateLimiter } = require('../middleware/rateLimiter');

const inviteLimiter = createRateLimiter({
  limit: 20,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'community-invite'
});


const router = express.Router();

function logTransaction(details) {
  try {
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    const logPath = path.join(logDir, 'transactions.log');
    const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(details)}\n`;
    fs.appendFileSync(logPath, logEntry, 'utf8');
    console.log(`[TRANSACTION_LOG] ${JSON.stringify(details)}`);
  } catch (err) {
    console.error('Failed to write transaction log:', err.message);
  }
}

function logCommunityEvent(action, details = {}) {
  try {
    const logDir = path.join(__dirname, '../logs');
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
      } catch (e) {
        // Ignore folder creation errors on serverless
      }
    }
    const logPath = path.join(logDir, 'community.log');
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] [COMMUNITY_EVENT] [${action}] ${JSON.stringify(details)}\n`;
    try {
      fs.appendFileSync(logPath, logEntry, 'utf8');
    } catch (e) {
      // Ignore write errors on read-only serverless filesystems
    }
    console.log(JSON.stringify({
      timestamp,
      level: 'INFO',
      module: 'community',
      action,
      ...details
    }));
  } catch (err) {
    console.error('Logging failed:', err.message);
  }
}

/**
 * GET /api/community/pricing-configs
 * Returns the seeding/pricing settings
 */
router.get('/pricing-configs', authenticateUser, async (req, res) => {
  try {
    const configs = await prisma.communityPricingConfig.findMany();
    res.json({ success: true, data: configs });
  } catch (error) {
    console.error('[Community] Get pricing error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/my-community
 * Get current user's communities if they are a member/owner
 */
router.get('/my-community', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const communityId = req.query.communityId ? Number(req.query.communityId) : null;
    
    // Find all memberships
    const memberRecords = await prisma.communityMember.findMany({
      where: { 
        user_id: userId,
        ...(communityId ? { community_id: communityId } : {})
      },
      include: {
        community: {
          include: {
            members: {
              include: {
                user: {
                  select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    avatar_url: true,
                    screen_name: true
                  }
                }
              }
            },
            groups: {
              include: {
                conversation: true
              }
            }
          }
        }
      }
    });

    if (memberRecords.length === 0) {
      return res.json({ success: true, inCommunity: false, communities: [] });
    }

    res.json({
      success: true,
      inCommunity: true,
      communities: memberRecords.map(r => ({
        ...r.community,
        logo_url: r.community ? r.community.avatar_url : null,
        role: r.role
      })),
      // Backward compatibility:
      role: memberRecords[0].role,
      community: memberRecords[0].community ? {
        ...memberRecords[0].community,
        logo_url: memberRecords[0].community.avatar_url
      } : null
    });
  } catch (error) {
    console.error('[Community] Get my community error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/create-order
 * Create a Razorpay order for community subscription
 */
const createOrderValidation = [
  body('planType').isIn(['Starter', 'Growth', 'Custom']).withMessage('Invalid plan type'),
  body('memberCount').optional().isInt({ min: 1 }).withMessage('Member count must be positive integer'),
  validateRequest
];

router.post('/create-order', authenticateUser, createOrderValidation, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { planType, memberCount } = req.body;

    const config = await prisma.communityPricingConfig.findUnique({
      where: { plan_type: planType }
    });

    if (!config) {
      return res.status(404).json({ success: false, message: 'Plan configuration not found' });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { secondary_role: true }
    });
    const isFounder = dbUser?.secondary_role?.toLowerCase() === 'founder';

    let price = Number(config.base_price);
    let maxMembers = config.max_members;

    if (planType === 'Custom') {
      if (!memberCount || isNaN(Number(memberCount)) || Number(memberCount) < 1) {
        return res.status(400).json({
          success: false,
          message: 'Member count is required and must be at least 1 for the Custom plan.'
        });
      }
      if (config.max_members && Number(memberCount) > config.max_members) {
        return res.status(400).json({
          success: false,
          message: `Member count exceeds system limit of ${config.max_members} for the Custom plan.`
        });
      }
      price = Number(config.base_price) + (Number(memberCount) * Number(config.per_member_price));
      maxMembers = Number(memberCount);
    }

    if (isFounder) {
      const orderId = `founder_order_${userId}_${Date.now()}`;
      await prisma.communitySubscription.create({
        data: {
          user_id: userId,
          plan_type: planType,
          max_members: maxMembers,
          price: 0,
          currency: 'INR',
          razorpay_order_id: orderId,
          status: 'pending'
        }
      });
      return res.json({
        success: true,
        is_founder: true,
        keyId: 'founder_bypass',
        order: {
          id: orderId,
          amount: 0,
          currency: 'INR'
        }
      });
    }

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;

    if (!keyId || !keySecret) {
      return res.status(503).json({ success: false, message: 'Razorpay keys are not configured' });
    }

    // Call Razorpay API
    const amountInPaise = Math.round(price * 100);
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
      },
      body: JSON.stringify({
        amount: amountInPaise,
        currency: 'INR',
        receipt: `community_sub_${userId}_${Date.now()}`,
        notes: {
          userId: String(userId),
          planType,
          maxMembers: String(maxMembers)
        }
      })
    });

    const orderData = await response.json();

    if (!response.ok || !orderData.id) {
      throw new Error(orderData.error?.description || 'Razorpay order creation failed');
    }

    // Create community subscription record
    await prisma.communitySubscription.create({
      data: {
        user_id: userId,
        plan_type: planType,
        max_members: maxMembers,
        price: price,
        currency: 'INR',
        razorpay_order_id: orderData.id,
        status: 'pending'
      }
    });

    res.json({
      success: true,
      keyId,
      order: {
        id: orderData.id,
        amount: orderData.amount,
        currency: orderData.currency
      }
    });
  } catch (error) {
    console.error('[Community] Create order error:', error.message);
    captureError(error, { action: 'community_order_creation_failed', extra: { userId: req.user.id } });
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
});

/**
 * POST /api/community/verify-payment
 * Verify Razorpay payment and create the community
 */
const verifyPaymentValidation = [
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('razorpay_payment_id').notEmpty().withMessage('Payment ID is required'),
  body('razorpay_signature').notEmpty().withMessage('Signature is required'),
  validateRequest
];

router.post('/verify-payment', authenticateUser, verifyPaymentValidation, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const keyId = process.env.RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return res.status(503).json({ success: false, message: 'Razorpay keys are not configured' });
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { secondary_role: true }
    });
    const isFounder = dbUser?.secondary_role?.toLowerCase() === 'founder';
    const isBypass = razorpay_order_id.startsWith('founder_order_') || razorpay_signature === 'founder_bypass';

    if (isBypass) {
      if (!isFounder) {
        return res.status(403).json({ success: false, message: 'Access denied: Payment bypass requires Founder role.' });
      }
    } else {
      // Verify signature
      const generatedSignature = crypto
        .createHmac('sha256', keySecret)
        .update(`${razorpay_order_id}|${razorpay_payment_id}`)
        .digest('hex');

      if (generatedSignature !== razorpay_signature) {
        console.warn(`[Community] Invalid signature for Order: ${razorpay_order_id}`);
        await prisma.communitySubscription.updateMany({
          where: { razorpay_order_id },
          data: { status: 'failed', updated_at: new Date() }
        });
        return res.status(400).json({ success: false, message: 'Payment verification failed' });
      }
    }

    // Retrieve pending or paid subscription
    const subscription = await prisma.communitySubscription.findUnique({
      where: { razorpay_order_id }
    });

    if (!subscription || (subscription.status !== 'pending' && subscription.status !== 'paid')) {
      return res.status(400).json({ success: false, message: 'No pending or paid subscription found for this order' });
    }

    if (!isBypass) {
      // Verify payment amount in paise from Razorpay directly to prevent replay attacks
      try {
        const payRes = await fetch(`https://api.razorpay.com/v1/payments/${razorpay_payment_id}`, {
          headers: {
            'Authorization': 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
          }
        });
        const payData = await payRes.json();
        if (!payRes.ok || payData.error) {
          throw new Error(payData.error?.description || 'Failed to fetch payment details from Razorpay');
        }
        
        const expectedPaise = Math.round(Number(subscription.price) * 100);
        if (Number(payData.amount) !== expectedPaise) {
          console.warn(`[Community] Amount mismatch: Razorpay got ${payData.amount} paise, subscription expected ${expectedPaise} paise.`);
          return res.status(400).json({ success: false, message: 'Payment verification failed: amount mismatch' });
        }
      } catch (err) {
        console.error('[Community] Razorpay payment check error:', err.message);
        return res.status(400).json({ success: false, message: 'Could not verify payment amount with Razorpay' });
      }
    }

    // Update Subscription status to paid
    const updatedSubscription = await prisma.communitySubscription.update({
      where: { id: subscription.id },
      data: {
        status: 'paid',
        razorpay_payment_id,
        razorpay_signature,
        updated_at: new Date()
      }
    });

    // Log the successful payment verification
    logTransaction({
      source: 'verify_payment_endpoint',
      userId,
      razorpay_order_id,
      razorpay_payment_id,
      price: subscription.price,
      isFounderBypass: isBypass,
      status: 'paid'
    });

    res.json({
      success: true,
      message: 'Payment verified successfully. You can now configure community details.',
      data: {
        razorpay_order_id: updatedSubscription.razorpay_order_id,
        status: updatedSubscription.status
      }
    });
  } catch (error) {
    console.error('[Community] Verify payment error:', error.message);
    captureError(error, { action: 'community_payment_verification_failed', extra: { body: req.body } });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/instantiate
 * Instantiate the community after payment is verified/paid
 */
const instantiateValidation = [
  body('razorpay_order_id').notEmpty().withMessage('Order ID is required'),
  body('name').trim().isLength({ min: 3, max: 100 }).withMessage('Community name must be between 3 and 100 characters'),
  body('description').optional().trim(),
  validateRequest
];

router.post('/instantiate', authenticateUser, instantiateValidation, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { razorpay_order_id, name, description } = req.body;

    const subscription = await prisma.communitySubscription.findFirst({
      where: {
        razorpay_order_id,
        user_id: userId
      }
    });

    if (!subscription) {
      return res.status(404).json({ success: false, message: 'Subscription not found for this order' });
    }

    if (subscription.status !== 'paid') {
      return res.status(400).json({
        success: false,
        message: `Subscription is not in a paid state (current status: ${subscription.status}).`
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Community
      const community = await tx.community.create({
        data: {
          name,
          description: description || '',
          owner_id: userId,
          max_members: subscription.max_members
        }
      });

      // 2. Add Owner as a Member
      await tx.communityMember.create({
        data: {
          community_id: community.id,
          user_id: userId,
          role: 'Owner'
        }
      });

      // 3. Create General Conversation
      const conversation = await tx.conversation.create({
        data: {
          is_group: true,
          name: 'General',
          members: {
            create: [
              { user_id: userId, role: 'Director' }
            ]
          }
        }
      });

      // 4. Create Community Group mapping
      await tx.communityGroup.create({
        data: {
          community_id: community.id,
          conversation_id: conversation.id,
          name: 'General'
        }
      });

      // 5. Update Subscription to Active
      await tx.communitySubscription.update({
        where: { id: subscription.id },
        data: {
          status: 'active',
          community_id: community.id,
          updated_at: new Date()
        }
      });

      return community;
    });

    logTransaction({
      source: 'instantiate_community_endpoint',
      userId,
      razorpay_order_id,
      communityId: result.id,
      name,
      status: 'active'
    });

    res.status(201).json({
      success: true,
      message: 'Community created and instantiated successfully',
      data: result
    });
  } catch (error) {
    console.error('[Community] Instantiate error:', error.message);
    captureError(error, { action: 'community_instantiation_failed', extra: { body: req.body } });
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/dashboard
 * Fetch stats for community dashboard (Owner/Moderator only)
 */
router.get('/dashboard', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const communityId = req.query.communityId ? Number(req.query.communityId) : undefined;

    // Find the community where user is owner or moderator
    const membership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        ...(communityId ? { community_id: communityId } : {}),
        role: { in: ['Owner', 'Moderator'] }
      },
      include: {
        community: {
          include: {
            members: true,
            groups: true
          }
        }
      }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    const { community } = membership;
    const activeSub = await prisma.communitySubscription.findFirst({
      where: { community_id: community.id, status: 'active' },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: {
        communityId: community.id,
        name: community.name,
        description: community.description,
        avatar_url: community.avatar_url,
        logo_url: community.avatar_url,
        banner_url: community.banner_url,
        owner_id: community.owner_id,
        max_members: community.max_members,
        memberCount: community.members.length,
        groupCount: community.groups.length,
        planType: activeSub ? activeSub.plan_type : 'Free',
        price: activeSub ? activeSub.price : 0
      }
    });
  } catch (error) {
    console.error('[Community] Get dashboard error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/members
 * Get list of community members
 */
router.get('/members', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    // Find caller's community
    const myMembership = await prisma.communityMember.findFirst({
      where: { user_id: userId }
    });

    if (!myMembership) {
      return res.status(400).json({ success: false, message: 'You are not a member of any community' });
    }

    const members = await prisma.communityMember.findMany({
      where: { community_id: myMembership.community_id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar_url: true
          }
        }
      }
    });

    res.json({ success: true, data: members });
  } catch (error) {
    console.error('[Community] Get members error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/members/invite
 * Invite a user by email to join the community (Owner/Moderator only)
 */
const inviteMemberValidation = [
  body('userId').isInt().withMessage('Valid user ID is required'),
  body('communityId').isInt().withMessage('Valid community ID is required'),
  validateRequest
];

router.post('/members/invite', authenticateUser, inviteLimiter, inviteMemberValidation, async (req, res) => {
  try {
    const callerId = Number(req.user.id);
    const userId = Number(req.body.userId);
    const communityId = Number(req.body.communityId);

    // Verify caller is Owner or Moderator of this specific community
    const myMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: callerId,
        community_id: communityId,
        role: { in: ['Owner', 'Moderator'] }
      },
      include: {
        community: {
          include: {
            members: true
          }
        }
      }
    });

    if (!myMembership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    const { community } = myMembership;

    // Check community capacity limit
    if (community.members.length >= community.max_members) {
      return res.status(400).json({
        success: false,
        message: `Community membership limit reached (${community.max_members} max). Please upgrade your subscription.`
      });
    }

    // Find invitee user
    const targetUser = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'Crew member not found' });
    }

    // Check if user is already in this community
    const targetMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: targetUser.id,
        community_id: communityId
      }
    });

    if (targetMembership) {
      return res.status(400).json({
        success: false,
        message: 'This crew member is already a member of this community.'
      });
    }

    // Check if there is already a PENDING invitation
    const existingInvitation = await prisma.communityInvitation.findFirst({
      where: {
        community_id: communityId,
        invitee_id: targetUser.id,
        status: 'PENDING'
      }
    });

    if (existingInvitation) {
      return res.status(400).json({
        success: false,
        message: 'An invitation is already pending for this crew member.'
      });
    }

    // Create the invitation
    await prisma.communityInvitation.create({
      data: {
        community_id: communityId,
        invitee_id: targetUser.id,
        inviter_id: callerId,
        status: 'PENDING'
      }
    });

    // Send notification email via Resend
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = require('resend');
        const resend = new Resend(process.env.RESEND_API_KEY);
        
        const callerUser = await prisma.user.findUnique({
          where: { id: callerId },
          select: { name: true }
        });
        const inviterName = callerUser ? callerUser.name : 'A crew leader';

        await resend.emails.send({
          from: 'TAKE ONE NEXUS <community@takeone-nexus.net.in>',
          to: [targetUser.email],
          subject: `INVITATION: Join ${community.name} on TAKE ONE NEXUS`,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <style>
                @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
                body { background-color: #06080a; color: #e0e0e0; font-family: 'Space Mono', monospace; margin: 0; padding: 0; }
                .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; border: 1px solid #00D4FF; background: linear-gradient(180deg, #0e1218 0%, #06080a 100%); }
                .header { text-align: center; padding-bottom: 30px; border-bottom: 1px solid rgba(0, 212, 255, 0.2); }
                .logo { font-size: 32px; font-weight: 700; letter-spacing: 0.2em; color: #ffffff; }
                .logo span { color: #00D4FF; }
                .content { padding: 30px 0; line-height: 1.6; }
                .greeting { font-size: 18px; color: #00D4FF; margin-bottom: 20px; }
                .cta-wrap { text-align: center; margin: 40px 0; }
                .cta { background-color: #00D4FF; color: #06080a !important; padding: 15px 30px; text-decoration: none; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; display: inline-block; border-radius: 4px; }
                .footer { font-size: 10px; color: #888888; text-align: center; padding-top: 30px; border-top: 1px solid rgba(0, 212, 255, 0.1); }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <div class="logo">TAKE <span>ONE</span></div>
                </div>
                <div class="content">
                  <div class="greeting">COMMUNITY INVITE: ${community.name}</div>
                  <p>Hi ${targetUser.name},</p>
                  <p>You have been invited by <strong>${inviterName}</strong> to join the community <strong>${community.name}</strong> on the TAKE ONE platform.</p>
                  <p>Accept this invitation to unlock shared chat spaces, crew call listings, and collaborative tools for this community.</p>
                  <div class="cta-wrap">
                    <a href="${process.env.NEXT_PUBLIC_APP_URL}/chat" class="cta">Accept Invitation</a>
                  </div>
                </div>
                <div class="footer">
                  © 2026 TAKE ONE NEXUS. ALL RIGHTS RESERVED.
                </div>
              </div>
            </body>
            </html>
          `
        });
      } catch (emailErr) {
        console.error('[Community] Failed to send invitation email:', emailErr.message);
      }
    }

    logCommunityEvent('member_invited', { communityId, inviteeId: targetUser.id, inviterId: callerId });

    res.json({
      success: true,
      message: `Invitation successfully sent to ${targetUser.name}.`
    });
  } catch (error) {
    console.error('[Community] Invite member error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/invitations/my-invitations
 * Get pending invitations for logged-in user
 */
router.get('/invitations/my-invitations', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const invitations = await prisma.communityInvitation.findMany({
      where: {
        invitee_id: userId,
        status: 'PENDING'
      },
      include: {
        community: true,
        inviter: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            avatar_url: true,
            screen_name: true
          }
        }
      }
    });

    const mappedInvitations = invitations.map(inv => ({
      ...inv,
      community: inv.community ? {
        ...inv.community,
        logo_url: inv.community.avatar_url
      } : null
    }));

    res.json({
      success: true,
      invitations: mappedInvitations
    });
  } catch (error) {
    console.error('[Community] Get my invitations error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/invitations/:id/accept
 * Accept a community invitation
 */
router.post('/invitations/:id/accept', authenticateUser, async (req, res) => {
  try {
    const invitationId = Number(req.params.id);
    const userId = Number(req.user.id);

    const invitation = await prisma.communityInvitation.findFirst({
      where: {
        id: invitationId,
        invitee_id: userId,
        status: 'PENDING'
      },
      include: {
        community: {
          include: {
            members: true,
            groups: true
          }
        }
      }
    });

    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found or already processed.' });
    }

    const { community } = invitation;

    // Check capacity
    if (community.members.length >= community.max_members) {
      return res.status(400).json({
        success: false,
        message: `Community membership limit reached (${community.max_members} max).`
      });
    }

    const generalGroup = community.groups.find(g => g.name === 'General');

    await prisma.$transaction(async (tx) => {
      // 1. Update invitation status to ACCEPTED
      await tx.communityInvitation.update({
        where: { id: invitationId },
        data: { status: 'ACCEPTED' }
      });

      // 2. Add CommunityMember record
      await tx.communityMember.create({
        data: {
          community_id: community.id,
          user_id: userId,
          role: 'Member'
        }
      });

      // 3. Add to General conversation
      if (generalGroup) {
        await tx.conversationMember.create({
          data: {
            conversation_id: generalGroup.conversation_id,
            user_id: userId,
            role: 'Member'
          }
        });
      }
    });

    logCommunityEvent('invitation_accepted', { invitationId, userId, communityId: community.id });

    res.json({
      success: true,
      message: `You have successfully joined ${community.name}.`
    });
  } catch (error) {
    console.error('[Community] Accept invitation error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/invitations/:id/reject
 * Reject a community invitation
 */
router.post('/invitations/:id/reject', authenticateUser, async (req, res) => {
  try {
    const invitationId = Number(req.params.id);
    const userId = Number(req.user.id);

    const invitation = await prisma.communityInvitation.findFirst({
      where: {
        id: invitationId,
        invitee_id: userId,
        status: 'PENDING'
      }
    });

    if (!invitation) {
      return res.status(404).json({ success: false, message: 'Invitation not found or already processed.' });
    }

    await prisma.communityInvitation.update({
      where: { id: invitationId },
      data: { status: 'REJECTED' }
    });

    logCommunityEvent('invitation_rejected', { invitationId, userId, communityId: invitation.community_id });

    res.json({
      success: true,
      message: 'Invitation rejected.'
    });
  } catch (error) {
    console.error('[Community] Reject invitation error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/logo
 * Local file logo upload
 */
router.post('/logo', authenticateUser, (req, res) => {
  uploadLogo.single('logo')(req, res, async (err) => {
    if (err) {
      const communityId = req.body ? Number(req.body.communityId || req.body.community_id) : null;
      logCommunityEvent('logo_upload_failed', { communityId, userId: Number(req.user.id), error: err.message });
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'File too large. Maximum size allowed is 5 MB.' });
      }
      return res.status(400).json({ success: false, message: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const communityId = Number(req.body.communityId || req.body.community_id);
      if (!communityId) {
        // Delete uploaded file if ID is missing
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(400).json({ success: false, message: 'Community ID is required' });
      }

      // Verify caller is Owner or Moderator
      const membership = await prisma.communityMember.findFirst({
        where: {
          user_id: Number(req.user.id),
          community_id: communityId,
          role: { in: ['Owner', 'Moderator'] }
        }
      });

      if (!membership) {
        // Delete uploaded file if unauthorized
        if (fs.existsSync(req.file.path)) {
          fs.unlinkSync(req.file.path);
        }
        return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
      }

      const logoUrl = `/uploads/logos/${req.file.filename}`;
      await prisma.community.update({
        where: { id: communityId },
        data: { avatar_url: logoUrl }
      });

      logCommunityEvent('logo_upload_success', { communityId, userId: Number(req.user.id), fileName: req.file.filename, size: req.file.size });

      res.json({
        success: true,
        logo_url: logoUrl,
        message: 'Community logo uploaded successfully.'
      });
    } catch (error) {
      console.error('[Community] Logo upload error:', error.message);
      logCommunityEvent('logo_upload_failed', { communityId: Number(req.body.communityId || req.body.community_id), userId: Number(req.user.id), error: error.message });
      if (req.file && fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
});

/**
 * DELETE /api/community/members/:userId
 * Remove a user from the community (Owner/Moderator rules apply)
 */
router.delete('/members/:userId', authenticateUser, async (req, res) => {
  try {
    const callerId = Number(req.user.id);
    const targetUserId = Number(req.params.userId);

    if (callerId === targetUserId) {
      return res.status(400).json({ success: false, message: 'You cannot remove yourself. Community Owners must delete or transfer community.' });
    }

    // Get caller's membership
    const callerMembership = await prisma.communityMember.findFirst({
      where: { user_id: callerId }
    });

    if (!callerMembership || !['Owner', 'Moderator'].includes(callerMembership.role)) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    // Get target's membership
    const targetMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: targetUserId,
        community_id: callerMembership.community_id
      }
    });

    if (!targetMembership) {
      return res.status(404).json({ success: false, message: 'Member not found in your community' });
    }

    // Role hierarchies:
    // Owner can remove anyone (except self)
    // Moderator can remove Member but NOT Owner or another Moderator
    if (callerMembership.role === 'Moderator' && ['Owner', 'Moderator'].includes(targetMembership.role)) {
      return res.status(403).json({ success: false, message: 'Access denied: Moderators cannot remove other moderators or owners' });
    }

    // Find all group conversation IDs for this community
    const communityGroups = await prisma.communityGroup.findMany({
      where: { community_id: callerMembership.community_id },
      select: { conversation_id: true }
    });
    const conversationIds = communityGroups.map(g => g.conversation_id);

    // Remove from community and conversations in transaction
    await prisma.$transaction([
      // Remove from CommunityMember
      prisma.communityMember.delete({
        where: { id: targetMembership.id }
      }),
      // Remove from ConversationMember for all community groups
      prisma.conversationMember.deleteMany({
        where: {
          user_id: targetUserId,
          conversation_id: { in: conversationIds }
        }
      })
    ]);

    res.json({ success: true, message: 'Member successfully removed from the community' });
  } catch (error) {
    console.error('[Community] Remove member error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/groups
 * Create a new group inside the community (Owner/Moderator only)
 */
const createGroupValidation = [
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Group name must be between 2 and 100 characters'),
  validateRequest
];

router.post('/groups', authenticateUser, createGroupValidation, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const { name } = req.body;

    // Find user's membership and check if Owner/Moderator
    const myMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        role: { in: ['Owner', 'Moderator'] }
      },
      include: {
        community: {
          include: {
            groups: true,
            members: true
          }
        }
      }
    });

    if (!myMembership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    const { community } = myMembership;

    // Limit check: max 50 groups
    if (community.groups.length >= 50) {
      return res.status(400).json({ success: false, message: 'Maximum limit of 50 groups reached' });
    }

    // Create group conversation with all community members added
    const memberIds = community.members.map(m => m.user_id);

    const result = await prisma.$transaction(async (tx) => {
      // 1. Create Conversation
      const conversation = await tx.conversation.create({
        data: {
          is_group: true,
          name: name,
          members: {
            create: memberIds.map(id => ({
              user_id: id,
              role: id === userId ? 'Director' : 'Member'
            }))
          }
        }
      });

      // 2. Create Community Group mapping
      const communityGroup = await tx.communityGroup.create({
        data: {
          community_id: community.id,
          conversation_id: conversation.id,
          name: name
        },
        include: {
          conversation: true
        }
      });

      return communityGroup;
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('[Community] Create group error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * DELETE /api/community/groups/:groupId
 * Delete a group from the community (Owner/Moderator only, except General)
 */
router.delete('/groups/:groupId', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const groupId = Number(req.params.groupId);

    // Verify caller has permissions
    const myMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        role: { in: ['Owner', 'Moderator'] }
      }
    });

    if (!myMembership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    // Find the community group
    const group = await prisma.communityGroup.findUnique({
      where: { id: groupId }
    });

    if (!group || group.community_id !== myMembership.community_id) {
      return res.status(404).json({ success: false, message: 'Group not found in your community' });
    }

    if (group.name === 'General') {
      return res.status(400).json({ success: false, message: 'The General announcement channel cannot be deleted' });
    }

    // Delete community group and cascade the conversation deletion
    await prisma.$transaction([
      prisma.communityGroup.delete({
        where: { id: groupId }
      }),
      prisma.conversation.delete({
        where: { id: group.conversation_id }
      })
    ]);

    res.json({ success: true, message: 'Group deleted successfully' });
  } catch (error) {
    console.error('[Community] Delete group error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/admin/subscriptions
 * Fetch all community subscription transactions/ledger. Only accessible by Admin or Founder.
 */
router.get('/admin/subscriptions', authenticateUser, requireAdmin, async (req, res) => {
  try {
    const subscriptions = await prisma.communitySubscription.findMany({
      include: {
        user: {
          select: {
            name: true,
            email: true
          }
        }
      },
      orderBy: {
        created_at: 'desc'
      }
    });

    const data = subscriptions.map(sub => ({
      id: sub.id,
      user_id: sub.user_id,
      community_id: sub.community_id,
      plan_type: sub.plan_type,
      max_members: sub.max_members,
      price: sub.price,
      currency: sub.currency,
      razorpay_order_id: sub.razorpay_order_id,
      razorpay_payment_id: sub.razorpay_payment_id,
      razorpay_signature: sub.razorpay_signature,
      status: sub.status,
      created_at: sub.created_at,
      updated_at: sub.updated_at,
      user_name: sub.user?.name || 'Creator',
      user_email: sub.user?.email || 'N/A'
    }));

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Community] Get admin subscriptions error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * PUT /api/community/pricing-configs/:planType
 * Update pricing configuration for a plan. Only accessible by Admin or Founder.
 */
router.put('/pricing-configs/:planType', authenticateUser, requireAdmin, [
  body('base_price').isNumeric().withMessage('Base price must be a number'),
  body('max_members').isInt({ min: 1 }).withMessage('Max members must be a positive integer'),
  body('per_member_price').optional().isNumeric().withMessage('Per member price must be a number'),
  validateRequest
], async (req, res) => {
  try {
    const { planType } = req.params;
    const { base_price, max_members, per_member_price } = req.body;

    const updated = await prisma.communityPricingConfig.upsert({
      where: { plan_type: planType },
      update: {
        base_price,
        max_members,
        per_member_price: per_member_price || 0.00
      },
      create: {
        plan_type: planType,
        base_price,
        max_members,
        per_member_price: per_member_price || 0.00
      }
    });

    res.json({ success: true, message: `Pricing configuration for ${planType} updated successfully`, data: updated });
  } catch (error) {
    console.error('[Community] Update pricing config error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/webhook
 * Razorpay webhook handler for community subscription lifecycle events
 */
router.post('/webhook', async (req, res) => {
  const signature = req.headers['x-razorpay-signature'];
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return res.status(400).json({ success: false, message: 'Missing webhook signature or secret' });
  }

  // Validate signature using raw body buffer
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex');

  if (expectedSignature !== signature) {
    console.warn('[Community Webhook] Signature verification failed');
    return res.status(400).json({ success: false, message: 'Invalid signature' });
  }

  const event = req.body.event;
  const payload = req.body.payload;

  console.log(`[Community Webhook] Received event: ${event}`);

  // Transaction logging
  logTransaction({
    source: 'razorpay_webhook',
    event,
    payload
  });

  try {
    if (event === 'payment.captured') {
      const paymentEntity = payload.payment.entity;
      const orderId = paymentEntity.order_id;
      
      // Update subscription status if pending
      const subscription = await prisma.communitySubscription.findUnique({
        where: { razorpay_order_id: orderId }
      });

      if (subscription && subscription.status === 'pending') {
        await prisma.communitySubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'paid', // Mark as paid so client can finish configuration
            razorpay_payment_id: paymentEntity.id,
            razorpay_signature: signature
          }
        });
        console.log(`[Community Webhook] Marked subscription ${subscription.id} as paid`);
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload.payment.entity;
      const orderId = paymentEntity.order_id;

      await prisma.communitySubscription.updateMany({
        where: { razorpay_order_id: orderId },
        data: { status: 'failed', updated_at: new Date() }
      });
      console.log(`[Community Webhook] Marked subscription for order ${orderId} as failed`);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('[Community Webhook] Processing error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/list-all
 * List all communities with search and user request status
 */
router.get('/list-all', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const search = req.query.search ? String(req.query.search).trim() : '';

    const communities = await prisma.community.findMany({
      where: {
        ...(search ? {
          OR: [
            { name: { contains: search } },
            { description: { contains: search } }
          ]
        } : {})
      },
      include: {
        members: true,
        join_requests: {
          where: { user_id: userId }
        }
      }
    });

    const data = communities.map(c => {
      const isMember = c.members.some(m => m.user_id === userId);
      const reqStatus = c.join_requests.length > 0 ? c.join_requests[0].status : null;
      const reqId = c.join_requests.length > 0 ? c.join_requests[0].id : null;
      const requestedDate = c.join_requests.length > 0 ? c.join_requests[0].created_at : null;

      return {
        id: c.id,
        name: c.name,
        description: c.description,
        logo_url: c.avatar_url,
        memberCount: c.members.length,
        isMember,
        requestStatus: reqStatus,
        requestId: reqId,
        requestedDate
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('[Community] List all communities error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/join-request
 * Create a new join request for a community
 */
router.post('/join-request', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const communityId = Number(req.body.communityId || req.body.community_id);

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'Community ID is required' });
    }

    const member = await prisma.communityMember.findFirst({
      where: { community_id: communityId, user_id: userId }
    });
    if (member) {
      return res.status(400).json({ success: false, message: 'You are already a member of this community.' });
    }

    const existing = await prisma.communityJoinRequest.findUnique({
      where: {
        community_id_user_id: {
          community_id: communityId,
          user_id: userId
        }
      }
    });

    if (existing) {
      if (existing.status === 'PENDING') {
        return res.status(400).json({ success: false, message: 'You already have a pending join request.' });
      }
      const updated = await prisma.communityJoinRequest.update({
        where: { id: existing.id },
        data: { status: 'PENDING', updated_at: new Date() }
      });
      return res.json({ success: true, message: 'Request submitted successfully.', data: updated });
    }

    const created = await prisma.communityJoinRequest.create({
      data: {
        community_id: communityId,
        user_id: userId,
        status: 'PENDING'
      }
    });

    res.json({ success: true, message: 'Request submitted successfully.', data: created });
  } catch (error) {
    console.error('[Community] Join request error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/my-requests
 * Get all requests made by the current user
 */
router.get('/my-requests', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const requests = await prisma.communityJoinRequest.findMany({
      where: { user_id: userId },
      include: {
        community: true
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({
      success: true,
      data: requests.map(r => ({
        id: r.id,
        status: r.status,
        requestedDate: r.created_at,
        updatedDate: r.updated_at,
        community: {
          id: r.community.id,
          name: r.community.name,
          logo_url: r.community.avatar_url
        }
      }))
    });
  } catch (error) {
    console.error('[Community] Get my requests error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * GET /api/community/incoming-requests
 * Get pending requests for community owner/moderator
 */
router.get('/incoming-requests', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const communityId = Number(req.query.communityId);

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'Community ID is required' });
    }

    const membership = await prisma.communityMember.findFirst({
      where: {
        community_id: communityId,
        user_id: userId,
        role: { in: ['Owner', 'Moderator'] }
      }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    const requests = await prisma.communityJoinRequest.findMany({
      where: { community_id: communityId, status: 'PENDING' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar_url: true,
            screen_name: true
          }
        }
      },
      orderBy: { created_at: 'desc' }
    });

    res.json({ success: true, data: requests });
  } catch (error) {
    console.error('[Community] Get incoming requests error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/join-request/:id/approve
 * Approve a join request
 */
router.post('/join-request/:id/approve', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const requestId = Number(req.params.id);

    const joinRequest = await prisma.communityJoinRequest.findUnique({
      where: { id: requestId },
      include: { community: true }
    });

    if (!joinRequest) {
      return res.status(404).json({ success: false, message: 'Join request not found.' });
    }

    const membership = await prisma.communityMember.findFirst({
      where: {
        community_id: joinRequest.community_id,
        user_id: userId,
        role: { in: ['Owner', 'Moderator'] }
      }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    if (joinRequest.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Request is already ${joinRequest.status.toLowerCase()}.` });
    }

    const memberCount = await prisma.communityMember.count({
      where: { community_id: joinRequest.community_id }
    });

    if (joinRequest.community.max_members && memberCount >= joinRequest.community.max_members) {
      return res.status(400).json({ success: false, message: 'This community has reached its maximum member capacity.' });
    }

    await prisma.$transaction(async (tx) => {
      const isMember = await tx.communityMember.findFirst({
        where: { community_id: joinRequest.community_id, user_id: joinRequest.user_id }
      });

      if (!isMember) {
        const group = await tx.communityGroup.findFirst({
          where: { community_id: joinRequest.community_id, name: 'General' }
        });

        await tx.communityMember.create({
          data: {
            community_id: joinRequest.community_id,
            user_id: joinRequest.user_id,
            role: 'Member'
          }
        });

        if (group) {
          await tx.conversationMember.create({
            data: {
              conversation_id: group.conversation_id,
              user_id: joinRequest.user_id,
              role: 'Member'
            }
          });
        }
      }

      await tx.communityJoinRequest.update({
        where: { id: requestId },
        data: { status: 'ACCEPTED' }
      });
    });

    res.json({ success: true, message: 'Request approved successfully.' });
  } catch (error) {
    console.error('[Community] Approve join request error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/**
 * POST /api/community/join-request/:id/reject
 * Reject a join request
 */
router.post('/join-request/:id/reject', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const requestId = Number(req.params.id);

    const joinRequest = await prisma.communityJoinRequest.findUnique({
      where: { id: requestId }
    });

    if (!joinRequest) {
      return res.status(404).json({ success: false, message: 'Join request not found.' });
    }

    const membership = await prisma.communityMember.findFirst({
      where: {
        community_id: joinRequest.community_id,
        user_id: userId,
        role: { in: ['Owner', 'Moderator'] }
      }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'Access denied: Community Management permissions required' });
    }

    if (joinRequest.status !== 'PENDING') {
      return res.status(400).json({ success: false, message: `Request is already ${joinRequest.status.toLowerCase()}.` });
    }

    await prisma.communityJoinRequest.update({
      where: { id: requestId },
      data: { status: 'REJECTED' }
    });

    res.json({ success: true, message: 'Request rejected successfully.' });
  } catch (error) {
    console.error('[Community] Reject join request error:', error.message);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

module.exports = router;
