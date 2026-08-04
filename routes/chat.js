const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middleware/validator');
const prisma = require('../utils/prisma');
const Pusher = require('pusher');
const { formatDisplayName } = require('../utils/formatting');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const { uploadToStorage } = require('../utils/supabase');


const router = express.Router();

// Rate limiter for Pusher authorization endpoint to prevent abuse
const pusherAuthLimiter = rateLimit({
  windowMs: 60 * 1000, // 60 seconds
  max: 100, // Max 100 authorization requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please wait before trying again.' }
});

// Rate limiter for group avatar upload endpoint (5 uploads/min per user)
const avatarUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  keyGenerator: (req) => `avatar-upload-${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many avatar upload attempts. Please wait a moment.' }
});

// Multer for group avatar uploads – memory storage, MIME allow-list, 5 MB cap
const groupAvatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and WEBP images are allowed.'), false);
    }
  }
});

// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true
});

function getConversationInclude() {
  return {
    community_groups: {
      select: {
        id: true,
        community_id: true,
        canMembersMessage: true,
        groupSettings: true
      }
    },
    members: {
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar_url: true,
            gender: true,
            role: true,
            college: true,
            city: true,
            skills: true,
            credits: true,
            created_at: true
          }
        }
      }
    },
    messages: {
      orderBy: { created_at: 'desc' },
      take: 1,
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
    }
  };
}

function transformConversation(c, userId) {
  const myMember = (c.members || []).find(m => m.user_id === userId);
  const communityGroup = c.community_groups?.[0] || null;
  const rawSettings = communityGroup?.groupSettings;
  const parsedSettings = rawSettings ? (typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings) : null;
  
  const groupSettings = parsedSettings || {
    visibility: 'Public',
    joinPolicy: 'Everyone',
    canMembersMessage: communityGroup ? (communityGroup.canMembersMessage ? 'Everyone' : 'Admins Only') : 'Everyone',
    canMembersInvite: 'Everyone',
    canMembersEdit: 'Admins and Owner',
    requireApproval: false
  };

  return {
    ...c,
    my_role: myMember ? myMember.role : 'Member',
    canMembersMessage: groupSettings ? (groupSettings.canMembersMessage === 'Everyone' || groupSettings.canMembersMessage ) : (communityGroup ? communityGroup.canMembersMessage : true),
    groupSettings,
    community_id: communityGroup ? communityGroup.community_id : null,
    users: (c.members || []).map(m => ({ 
      ...m.user, 
      name: formatDisplayName(m.user.name),
      role_in_group: m.role 
    })),
    messages: (c.messages || []).map(m => ({
      ...m,
      sender: m.sender ? { 
        ...m.sender, 
        name: formatDisplayName(m.sender.name) 
      } : {
        id: m.sender_id || 0,
        name: 'Deleted User',
        role: 'Unknown'
      }
    }))
  };
}

/**
 * GET /api/chat/conversations
 * Get all conversations for the logged-in user
 */
router.get('/conversations', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    
    if (!userId || isNaN(userId)) {
      console.warn('[CHAT_API] Invalid user ID in request:', req.user);
      return res.status(401).json({ success: false, message: 'Invalid session' });
    }

    const conversations = await prisma.conversation.findMany({
      where: {
        members: {
          some: { user_id: userId }
        }
      },
      include: getConversationInclude(),
      orderBy: { updated_at: 'desc' }
    });

    res.json({
      success: true,
      data: conversations.map(c => transformConversation(c, userId)),
      pusherKey: process.env.NEXT_PUBLIC_PUSHER_KEY || process.env.PUSHER_KEY || '',
      pusherCluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || process.env.PUSHER_CLUSTER || ''
    });
  } catch (error) {
    console.error('[CHAT_API] Fetch conversations error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: 'Could not load conversations. Please check your signal connection.' 
    });
  }
});

/**
 * GET /api/chat/unread-count
 * Get unread message count for the logged-in user
 */
router.get('/unread-count', authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user.id);
    const count = await prisma.message.count({
      where: {
        is_read: false,
        sender_id: { not: userId },
        conversation: {
          members: { some: { user_id: userId } }
        }
      }
    });
    res.json({ 
      success: true, 
      count,
      pusherKey: process.env.NEXT_PUBLIC_PUSHER_KEY,
      pusherCluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER
    });
  } catch (error) {
    console.error('Fetch unread count error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load unread count' });
  }
});

/**
 * POST /api/chat/conversations/direct
 * Create or reuse a direct two-person conversation.
 */
const directConvValidation = [
  body('recipientId').isNumeric().withMessage('Recipient ID is required'),
  validateRequest
];

router.post('/conversations/direct', authenticateUser, directConvValidation, async (req, res) => {
  try {
    const senderId = Number(req.user.id);
    const recipientId = Number(req.body.recipientId);

    if (!recipientId || Number.isNaN(recipientId)) {
      return res.status(400).json({ success: false, message: 'Valid recipient id is required' });
    }

    if (recipientId === senderId) {
      return res.status(400).json({ success: false, message: 'Take One: You cannot start a self-transmission.' });
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true }
    });

    if (!recipient) {
      return res.status(404).json({ success: false, message: 'Crew member not found' });
    }

    const candidates = await prisma.conversation.findMany({
      where: {
        AND: [
          { members: { some: { user_id: senderId } } },
          { members: { some: { user_id: recipientId } } }
        ],
        is_group: false
      },
      include: getConversationInclude(),
      orderBy: { updated_at: 'desc' }
    });

    const existingConversation = candidates.find((conversation) => conversation.members.length === 2) || candidates[0];

    if (existingConversation) {
      return res.json({
        success: true,
        created: false,
        data: transformConversation(existingConversation, senderId)
      });
    }

    const conversation = await prisma.conversation.create({
      data: {
        is_group: false,
        members: {
          create: [
            { user_id: senderId, role: 'Member' },
            { user_id: recipientId, role: 'Member' }
          ]
        }
      },
      include: getConversationInclude()
    });

    res.status(201).json({
      success: true,
      created: true,
      data: transformConversation(conversation, senderId)
    });
  } catch (error) {
    console.error('Direct conversation error:', error.message);
    res.status(500).json({ success: false, message: 'Could not open conversation' });
  }
});

/**
 * POST /api/chat/conversations/group
 * Create a group conversation.
 */
const groupConvValidation = [
  body('name').trim().notEmpty().withMessage('Group name is required').isLength({ max: 100 }),
  body('userIds').isArray({ min: 1 }).withMessage('At least one member is required'),
  validateRequest
];

router.post('/conversations/group', authenticateUser, groupConvValidation, async (req, res) => {
  return res.status(403).json({
    success: false,
    message: "Group creation is available only inside Communities."
  });
});

/**
 * GET /api/chat/messages/:conversationId
 * Get message history for a conversation
 */
router.get('/messages/:conversationId', authenticateUser, [
  param('conversationId').isNumeric().withMessage('Invalid conversation ID'),
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('before').optional().isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.conversationId);
    const userId = Number(req.user?.id);

    if (!userId || isNaN(userId)) {
      return res.status(401).json({ success: false, message: 'Invalid session' });
    }

    if (!conversationId || isNaN(conversationId)) {
      return res.status(400).json({ success: false, message: 'Invalid conversation ID' });
    }

    // Check if user is part of the conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: {
          some: { user_id: userId }
        }
      }
    });

    if (!conversation) {
      console.warn(`[CHAT_API] Access denied for user ${userId} to conversation ${conversationId}`);
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Mark messages as read
    await prisma.message.updateMany({
      where: {
        conversation_id: conversationId,
        OR: [
          { sender_id: { not: userId } },
          { sender_id: null }
        ],
        is_read: false
      },
      data: { is_read: true }
    });

    const limit = parseInt(req.query.limit) || 50;
    const before = req.query.before ? parseInt(req.query.before) : null;

    const messages = await prisma.message.findMany({
      where: { 
        conversation_id: conversationId,
        ...(before ? { id: { lt: before } } : {})
      },
      orderBy: { created_at: 'desc' },
      take: limit,
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

    const sortedMessages = [...messages].reverse();

    res.json({
      success: true,
      hasMore: messages.length === limit,
      data: sortedMessages.map(m => ({
        ...m,
        sender: m.sender ? { 
          ...m.sender, 
          name: formatDisplayName(m.sender.name) 
        } : {
          id: m.sender_id || 0,
          name: 'Deleted User',
          role: 'Unknown'
        }
      }))
    });
  } catch (error) {
    console.error('[CHAT_API] Fetch messages error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load messages history' });
  }
});

/**
 * POST /api/chat/messages
 * Send a new message
 */
const messageValidation = [
  body('content').trim().notEmpty().withMessage('Message content cannot be empty').isLength({ max: 5000 }),
  body('conversationId').optional().isNumeric(),
  body('recipientId').optional().isNumeric(),
  body('tempId').optional().isString(),
  validateRequest
];

router.post('/messages', authenticateUser, messageValidation, async (req, res) => {
  try {
    const { conversationId, content, recipientId, tempId } = req.body;
    const senderId = Number(req.user?.id);

    if (!senderId || isNaN(senderId)) {
      return res.status(401).json({ success: false, message: 'Invalid session' });
    }

    if (!content || (!conversationId && !recipientId)) {
      return res.status(400).json({ success: false, message: 'Invalid request' });
    }

    let targetConversationId = conversationId;
    let targetRecipientId = recipientId ? Number(recipientId) : null;

    if (targetConversationId) {
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: Number(targetConversationId),
          members: {
            some: { user_id: senderId }
          }
        },
        include: {
          members: { select: { user_id: true } }
        }
      });

      if (!conversation) {
        console.error('[CHAT_API] Access denied to conversation:', conversationId, 'for user:', senderId);
        return res.status(403).json({ success: false, message: 'Access denied' });
      }

      if (conversation.is_group) {
        const communityGroup = await prisma.communityGroup.findFirst({
          where: { conversation_id: conversation.id }
        });
        if (communityGroup) {
          const rawSettings = communityGroup.groupSettings;
          const parsedSettings = rawSettings ? (typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings) : null;
          const canMessageSetting = parsedSettings ? parsedSettings.canMembersMessage : (communityGroup.canMembersMessage ? 'Everyone' : 'Admins Only');
          
          if (canMessageSetting === 'Admins Only') {
            // Check if sender is an Owner or Moderator in the associated Community
            const senderMembership = await prisma.communityMember.findFirst({
              where: {
                user_id: senderId,
                community_id: communityGroup.community_id,
                role: { in: ['Owner', 'Moderator'] }
              }
            });
            // Or if sender is Admin/Director in group conversation
            const myConvMember = await prisma.conversationMember.findFirst({
              where: {
                conversation_id: conversation.id,
                user_id: senderId
              }
            });
            const isGroupAdmin = myConvMember && (myConvMember.role === 'Admin' || myConvMember.role === 'Director');
            
            if (!senderMembership && !isGroupAdmin) {
              return res.status(403).json({
                success: false,
                message: 'Only admins can send messages in this group.'
              });
            }
          }
        }
      }

      if (!conversation.is_group && conversation.members.length < 2) {
        return res.status(400).json({ success: false, message: 'This user is no longer available.' });
      }

      targetConversationId = conversation.id;
      targetRecipientId = conversation.members.find((m) => m.user_id !== senderId)?.user_id || null;
    }

    // If no conversationId, check if a conversation already exists with recipient
    if (!targetConversationId && targetRecipientId) {
      if (targetRecipientId === senderId) {
        return res.status(400).json({ success: false, message: 'You cannot message yourself' });
      }

      const recipient = await prisma.user.findUnique({
        where: { id: Number(targetRecipientId) },
        select: { id: true }
      });

      if (!recipient) {
        return res.status(404).json({ success: false, message: 'Recipient not found' });
      }

      const existingConversations = await prisma.conversation.findMany({
        where: {
          AND: [
            { members: { some: { user_id: senderId } } },
            { members: { some: { user_id: Number(targetRecipientId) } } }
          ],
          is_group: false
        },
        include: { members: { select: { user_id: true } } },
        orderBy: { updated_at: 'desc' }
      });
      const existingConversation = existingConversations.find((conversation) => conversation.members.length === 2) || existingConversations[0];

      if (existingConversation) {
        targetConversationId = existingConversation.id;
      } else {
        // Create new conversation
        const newConversation = await prisma.conversation.create({
          data: {
            is_group: false,
            members: {
              create: [
                { user_id: senderId, role: 'Member' },
                { user_id: Number(targetRecipientId), role: 'Member' }
              ]
            }
          }
        });
        targetConversationId = newConversation.id;
      }
    }

    // Create the message
    const message = await prisma.message.create({
      data: {
        conversation_id: targetConversationId,
        sender_id: senderId,
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

    // Update conversation updated_at
    await prisma.conversation.update({
      where: { id: targetConversationId },
      data: { updated_at: new Date() }
    });

    // Trigger Pusher event
    if (process.env.PUSHER_APP_ID) {

      pusher.trigger(`conversation-${targetConversationId}`, 'new-message', {
        ...message,
        tempId: tempId || null,
        sender: {
          ...message.sender,
          name: formatDisplayName(message.sender?.name)
        }
      });
      
      // Also notify recipient's personal channel for unread indicators/sidebar updates
      if (targetRecipientId) {
        pusher.trigger(`user-${targetRecipientId}`, 'message-notification', {
          conversationId: targetConversationId,
          message
        });
      }
    } else {
      console.warn('[CHAT_API] Pusher not configured, skipping event trigger');
    }

    res.json({
      success: true,
      data: {
        ...message,
        tempId: tempId || null
      }
    });
  } catch (error) {
    console.error('Send message error:', error.message);
    res.status(500).json({ success: false, message: 'Could not send message' });
  }
});

/**
 * POST /api/chat/typing
 * Notify others that user is typing
 */
router.post('/typing', authenticateUser, [
  body('conversationId').isNumeric(),
  body('isTyping').isBoolean(),
  validateRequest
], async (req, res) => {
  try {
    const { conversationId, isTyping } = req.body;
    const userId = Number(req.user?.id);
    const userName = formatDisplayName(req.user?.name || 'User');

    if (!userId || isNaN(userId)) {
      return res.status(401).json({ success: true }); // Silent fail for typing
    }

    if (process.env.PUSHER_APP_ID) {
      pusher.trigger(`conversation-${conversationId}`, 'user-typing', {
        userId,
        userName,
        isTyping
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false });
  }
});

/**
 * DELETE /api/chat/conversations/:id
 * Remove user from a conversation (effectively deleting it for them)
 */
router.delete('/conversations/:id', authenticateUser, [
  param('id').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    // Delete membership
    await prisma.conversationMember.deleteMany({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    res.json({ success: true, message: 'Conversation removed' });
  } catch (error) {
    console.error('Delete conversation error:', error.message);
    res.status(500).json({ success: false, message: 'Could not remove conversation' });
  }
});

/**
 * POST /api/chat/conversations/:id/leave
 * Leave a group conversation
 */
router.post('/conversations/:id/leave', authenticateUser, [
  param('id').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    // First check if it's a group
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { is_group: true }
    });

    if (!conversation?.is_group) {
      return res.status(400).json({ success: false, message: 'Can only leave group conversations' });
    }

    // Delete membership
    await prisma.conversationMember.deleteMany({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    res.json({ success: true, message: 'Left group conversation' });
  } catch (error) {
    console.error('Leave group error:', error.message);
    res.status(500).json({ success: false, message: 'Could not leave group' });
  }
});

/**
 * POST /api/chat/conversations/:id/clear
 * Clear all messages in a conversation (only for Directors/Admins)
 */
router.post('/conversations/:id/clear', authenticateUser, [
  param('id').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    // Check if user is part of the conversation and get their role
    const conversationMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId
      },
      select: {
        role: true
      }
    });

    if (!conversationMember) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Only allow Directors and Admins to clear chat history
    if (conversationMember.role !== 'Director' && conversationMember.role !== 'Admin') {
      return res.status(403).json({ success: false, message: 'Only Directors and Admins can clear chat history' });
    }

    // Delete all messages in the conversation
    await prisma.message.deleteMany({
      where: { conversation_id: conversationId }
    });

    res.json({ success: true, message: 'Chat history cleared' });
  } catch (error) {
    console.error('Clear chat error:', error.message);
    res.status(500).json({ success: false, message: 'Could not clear chat history' });
  }
});


/**
 * POST /api/chat/conversations/:id/avatar
 * Upload a group conversation avatar image to Supabase Storage.
 * Accepts multipart/form-data with a single field named 'avatar'.
 * Only Admin or Director members are permitted.
 */
router.post('/conversations/:id/avatar', authenticateUser, avatarUploadLimiter, (req, res) => {
  groupAvatarUpload.single('avatar')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ success: false, message: 'File too large. Maximum size is 5 MB.' });
      }
      return res.status(400).json({ success: false, message: err.message });
    }

    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded. Please attach an image.' });
      }

      if (!req.params.id || isNaN(Number(req.params.id))) {
        return res.status(400).json({ success: false, message: 'Invalid conversation ID.' });
      }

      const conversationId = Number(req.params.id);
      const userId = Number(req.user.id);

      // Verify the conversation exists and the caller is an Admin or Director
      const membership = await prisma.conversationMember.findFirst({
        where: {
          conversation_id: conversationId,
          user_id: userId,
          role: { in: ['Admin', 'Director'] }
        },
        include: { conversation: { select: { is_group: true } } }
      });

      if (!membership) {
        return res.status(403).json({ success: false, message: 'Access denied: Admin or Director role required.' });
      }

      if (!membership.conversation.is_group) {
        return res.status(400).json({ success: false, message: 'Can only update group avatars.' });
      }

      // Derive safe file extension from the validated MIME type (never from user input)
      const mimeToExt = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
      const ext = mimeToExt[req.file.mimetype] || '.jpg';

      // Deterministic, upsert-friendly storage path – no user-supplied filename used
      const storagePath = `group-avatars/${conversationId}/avatar${ext}`;

      const avatarUrl = await uploadToStorage(
        req.file.buffer,
        'group-avatars',
        `${conversationId}/avatar${ext}`,
        req.file.mimetype
      );

      // Persist the public URL
      const updatedConversation = await prisma.conversation.update({
        where: { id: conversationId },
        data: { avatar_url: avatarUrl },
        include: getConversationInclude()
      });

      const transformed = transformConversation(updatedConversation, userId);

      // Broadcast the update via Pusher so all members see the change in real-time
      pusher.trigger(`conversation-${conversationId}`, 'avatar-updated', {
        conversationId,
        avatar_url: avatarUrl
      });

      const members = await prisma.conversationMember.findMany({
        where: { conversation_id: conversationId },
        select: { user_id: true }
      });

      for (const member of members) {
        pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', transformed);
      }

      res.json({ success: true, avatar_url: avatarUrl, data: transformed });
    } catch (error) {
      console.error('Group avatar upload error:', error.message);
      res.status(500).json({ success: false, message: 'Could not upload group avatar.' });
    }
  });
});

/**
 * DELETE /api/chat/conversations/:id/avatar
 * Remove the group avatar and reset to the default.
 * Only Admin or Director members are permitted.
 */
router.delete('/conversations/:id/avatar', authenticateUser, [
  param('id').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    // Verify the caller is an Admin or Director
    const membership = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId,
        role: { in: ['Admin', 'Director'] }
      },
      include: { conversation: { select: { is_group: true } } }
    });

    if (!membership) {
      return res.status(403).json({ success: false, message: 'Access denied: Admin or Director role required.' });
    }

    if (!membership.conversation.is_group) {
      return res.status(400).json({ success: false, message: 'Can only update group avatars.' });
    }

    // Reset avatar_url to null
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { avatar_url: null },
      include: getConversationInclude()
    });

    const transformed = transformConversation(updatedConversation, userId);

    pusher.trigger(`conversation-${conversationId}`, 'avatar-updated', {
      conversationId,
      avatar_url: null
    });

    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', transformed);
    }

    res.json({ success: true, message: 'Group avatar removed.' });
  } catch (error) {
    console.error('Group avatar remove error:', error.message);
    res.status(500).json({ success: false, message: 'Could not remove group avatar.' });
  }
});

/**
 * PATCH /api/chat/conversations/:id/settings
 * Update group conversation settings (visibility, joinPolicy, etc.)
 */
router.patch('/conversations/:id/settings', authenticateUser, [
  param('id').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);
    const { name, visibility, joinPolicy, canMembersMessage, canMembersInvite, canMembersEdit, requireApproval } = req.body;

    // Check if user is part of the conversation
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { user_id: userId } }
      }
    });

    if (!conversation) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    if (!conversation.is_group) {
      return res.status(400).json({ success: false, message: 'Can only update group settings' });
    }

    // Find the community group associated with this conversation
    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Community group not found' });
    }

    // Check current settings policy for edits
    const currentSettings = communityGroup.groupSettings ? (typeof communityGroup.groupSettings === 'string' ? JSON.parse(communityGroup.groupSettings) : communityGroup.groupSettings) : null;
    const canEditPolicy = currentSettings?.canMembersEdit || 'Admins and Owner';

    // Verify caller permissions
    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        community_id: communityGroup.community_id
      }
    });

    const conversationMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    const isCommunityOwner = communityMembership?.role === 'Owner';
    const isCommunityModerator = communityMembership?.role === 'Moderator';
    const isGroupDirector = conversationMember?.role === 'Director';
    const isGroupAdmin = conversationMember?.role === 'Admin';

    let hasEditPermission = false;
    if (isCommunityOwner || isGroupDirector) {
      hasEditPermission = true;
    } else if (canEditPolicy === 'Admins and Owner') {
      if (isCommunityModerator || isGroupAdmin) {
        hasEditPermission = true;
      }
    }

    if (!hasEditPermission) {
      return res.status(403).json({ success: false, message: 'Access denied: Insufficient permissions to edit group details' });
    }

    // Prepare updated settings
    const updatedSettings = {
      visibility: visibility || currentSettings?.visibility || 'Public',
      joinPolicy: joinPolicy || currentSettings?.joinPolicy || 'Everyone',
      canMembersMessage: canMembersMessage !== undefined ? canMembersMessage : (currentSettings?.canMembersMessage !== undefined ? currentSettings.canMembersMessage : 'Everyone'),
      canMembersInvite: canMembersInvite !== undefined ? canMembersInvite : (currentSettings?.canMembersInvite !== undefined ? currentSettings.canMembersInvite : 'Everyone'),
      canMembersEdit: canMembersEdit || currentSettings?.canMembersEdit || 'Admins and Owner',
      requireApproval: requireApproval !== undefined ? requireApproval : (joinPolicy === 'Approval Required' || currentSettings?.requireApproval || false)
    };

    const updateData = {
      groupSettings: updatedSettings
    };

    if (name) {
      updateData.name = name;
      await prisma.conversation.update({
        where: { id: conversationId },
        data: { name }
      });
    }

    if (canMembersMessage !== undefined) {
      updateData.canMembersMessage = (canMembersMessage === 'Everyone' || canMembersMessage === true);
    }

    // Update community group
    await prisma.communityGroup.update({
      where: { id: communityGroup.id },
      data: updateData
    });

    // Reload conversation to get fresh include data
    const updatedConversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: getConversationInclude()
    });

    const transformed = transformConversation(updatedConversation, userId);

    // Broadcast the update via Pusher to the conversation channel
    pusher.trigger(`conversation-${conversationId}`, 'settings-updated', {
      conversationId,
      canMembersMessage: updatedSettings.canMembersMessage,
      conversation: transformed
    });

    // Also notify all member channels with full conversation-update
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      const memberTransformed = transformConversation(updatedConversation, member.user_id);
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', memberTransformed);
    }

    res.json({ success: true, data: transformed });
  } catch (error) {
    console.error('Update settings error:', error.message);
    res.status(500).json({ success: false, message: 'Could not update group settings' });
  }
});

/**
 * GET /api/chat/conversations/:id/settings
 * Fetch settings for a group conversation
 */
router.get('/conversations/:id/settings', authenticateUser, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        members: { some: { user_id: userId } }
      }
    });

    if (!conversation) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Community group not found' });
    }

    const rawSettings = communityGroup.groupSettings;
    const groupSettings = rawSettings ? (typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings) : {
      visibility: 'Public',
      joinPolicy: 'Everyone',
      canMembersMessage: communityGroup.canMembersMessage ? 'Everyone' : 'Admins Only',
      canMembersInvite: 'Everyone',
      canMembersEdit: 'Admins and Owner',
      requireApproval: false
    };

    return res.json({ success: true, settings: groupSettings });
  } catch (error) {
    console.error('Fetch settings error:', error.message);
    res.status(500).json({ success: false, message: 'Could not fetch settings' });
  }
});

/**
 * POST /api/chat/conversations/:id/join
 * Join or request to join a community group
 */
router.post('/conversations/:id/join', authenticateUser, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Check community membership
    const communityMember = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        community_id: communityGroup.community_id
      }
    });

    if (!communityMember) {
      return res.status(403).json({ success: false, message: 'Must be a member of the community to join this group' });
    }

    // Check if already in conversation
    const existingMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    if (existingMember) {
      return res.status(400).json({ success: false, message: 'You are already a member of this group' });
    }

    const rawSettings = communityGroup.groupSettings;
    const settings = rawSettings ? (typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings) : { joinPolicy: 'Everyone' };
    const joinPolicy = settings.joinPolicy || 'Everyone';

    if (joinPolicy === 'Invite Only') {
      return res.status(403).json({ success: false, message: 'This group is invite-only' });
    }

    if (joinPolicy === 'Approval Required') {
      // Check if join request already exists
      const existingRequest = await prisma.groupJoinRequest.findFirst({
        where: {
          group_id: communityGroup.id,
          user_id: userId
        }
      });

      if (existingRequest) {
        return res.json({ success: true, status: 'PENDING', message: 'Join request already pending' });
      }

      await prisma.groupJoinRequest.create({
        data: {
          group_id: communityGroup.id,
          user_id: userId,
          status: 'PENDING'
        }
      });

      pusher.trigger(`conversation-${conversationId}`, 'join-requests-updated', { conversationId });

      return res.json({ success: true, status: 'PENDING', message: 'Join request submitted. Awaiting approval.' });
    }

    // Join directly
    await prisma.conversationMember.create({
      data: {
        conversation_id: conversationId,
        user_id: userId,
        role: 'Member'
      }
    });

    const updatedConv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: getConversationInclude()
    });
    const transformed = transformConversation(updatedConv, userId);

    // Notify Pusher channel
    pusher.trigger(`conversation-${conversationId}`, 'member-joined', {
      userId,
      conversationId,
      conversation: transformed
    });

    // Notify all member channels
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      const memberTransformed = transformConversation(updatedConv, member.user_id);
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', memberTransformed);
    }

    return res.json({ success: true, status: 'JOINED', conversation: transformed });
  } catch (error) {
    console.error('Join group error:', error.message);
    res.status(500).json({ success: false, message: 'Could not join group' });
  }
});

/**
 * POST /api/chat/conversations/:id/add-member
 * Add/Invite a member to a group conversation
 */
router.post('/conversations/:id/add-member', authenticateUser, [
  param('id').isNumeric(),
  body('userId').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userIdToAdd = Number(req.body.userId);
    const requesterId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Check if requester is in the group
    const requesterMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: requesterId
      }
    });

    if (!requesterMember) {
      return res.status(403).json({ success: false, message: 'You must be in the group to invite members' });
    }

    // Check if user to add is in community
    const targetCommunityMember = await prisma.communityMember.findFirst({
      where: {
        user_id: userIdToAdd,
        community_id: communityGroup.community_id
      }
    });

    if (!targetCommunityMember) {
      return res.status(400).json({ success: false, message: 'User must be a member of the community to join this group' });
    }

    // Check if user to add is already in group
    const existingMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userIdToAdd
      }
    });

    if (existingMember) {
      return res.status(400).json({ success: false, message: 'User is already a member of this group' });
    }

    // Check invitation permission policy
    const rawSettings = communityGroup.groupSettings;
    const settings = rawSettings ? (typeof rawSettings === 'string' ? JSON.parse(rawSettings) : rawSettings) : null;
    const canInvitePolicy = settings?.canMembersInvite || 'Everyone';

    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: requesterId,
        community_id: communityGroup.community_id
      }
    });

    const isCommunityAdmin = communityMembership?.role === 'Owner' || communityMembership?.role === 'Moderator';
    const isGroupAdmin = requesterMember.role === 'Admin' || requesterMember.role === 'Director';

    if (canInvitePolicy === 'Admins Only' && !isCommunityAdmin && !isGroupAdmin) {
      return res.status(403).json({ success: false, message: 'Only admins/owners can add members to this group' });
    }

    // Add member
    await prisma.conversationMember.create({
      data: {
        conversation_id: conversationId,
        user_id: userIdToAdd,
        role: 'Member'
      }
    });

    // Clean up join request if any
    await prisma.groupJoinRequest.deleteMany({
      where: {
        group_id: communityGroup.id,
        user_id: userIdToAdd
      }
    });

    const updatedConv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: getConversationInclude()
    });

    // Notify Pusher channel
    pusher.trigger(`conversation-${conversationId}`, 'member-joined', {
      userId: userIdToAdd,
      conversationId
    });

    // Notify all member channels
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      const memberTransformed = transformConversation(updatedConv, member.user_id);
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', memberTransformed);
    }

    return res.json({ success: true, conversation: transformConversation(updatedConv, requesterId) });
  } catch (error) {
    console.error('Add member error:', error.message);
    res.status(500).json({ success: false, message: 'Could not add member to group' });
  }
});

/**
 * POST /api/chat/conversations/:id/remove-member
 * Remove a member from a group conversation (Admins/Owner only)
 */
router.post('/conversations/:id/remove-member', authenticateUser, [
  param('id').isNumeric(),
  body('userId').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const targetUserId = Number(req.body.userId);
    const requesterId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (communityGroup.name === 'General') {
      return res.status(400).json({ success: false, message: 'Cannot remove members from the General channel' });
    }

    // Verify requester role
    const requesterMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: requesterId
      }
    });

    const targetMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: targetUserId
      }
    });

    if (!targetMember) {
      return res.status(404).json({ success: false, message: 'Member not found in group' });
    }

    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: requesterId,
        community_id: communityGroup.community_id
      }
    });

    const isCommunityAdmin = communityMembership?.role === 'Owner' || communityMembership?.role === 'Moderator';
    const isGroupAdmin = requesterMember && (requesterMember.role === 'Admin' || requesterMember.role === 'Director');

    if (!isCommunityAdmin && !isGroupAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied: Admin privileges required to remove members' });
    }

    // Prevent demoting/removing higher-level roles by lower-level roles
    const targetCommunityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: targetUserId,
        community_id: communityGroup.community_id
      }
    });

    const isTargetCommunityOwner = targetCommunityMembership?.role === 'Owner';
    const isTargetGroupDirector = targetMember.role === 'Director';

    if ((isTargetCommunityOwner || isTargetGroupDirector) && requesterId !== targetUserId) {
      return res.status(403).json({ success: false, message: 'Cannot remove the group Owner/Director' });
    }

    // Perform removal
    await prisma.conversationMember.delete({
      where: { id: targetMember.id }
    });

    const updatedConv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: getConversationInclude()
    });

    // Notify Pusher channel
    pusher.trigger(`conversation-${conversationId}`, 'member-left', {
      userId: targetUserId,
      conversationId
    });

    // Notify the removed user
    pusher.trigger(`user-${targetUserId}-chats`, 'conversation-removed', { conversationId });

    // Notify all remaining member channels
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      const memberTransformed = transformConversation(updatedConv, member.user_id);
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', memberTransformed);
    }

    return res.json({ success: true, message: 'Member removed successfully' });
  } catch (error) {
    console.error('Remove member error:', error.message);
    res.status(500).json({ success: false, message: 'Could not remove member' });
  }
});

/**
 * PATCH /api/chat/conversations/:id/member-role
 * Update role of a member in a group (Promote/Demote)
 */
router.patch('/conversations/:id/member-role', authenticateUser, [
  param('id').isNumeric(),
  body('userId').isNumeric(),
  body('role').isIn(['Admin', 'Member']),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const targetUserId = Number(req.body.userId);
    const newRole = req.body.role;
    const requesterId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Verify requester role
    const requesterMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: requesterId
      }
    });

    const targetMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: targetUserId
      }
    });

    if (!targetMember) {
      return res.status(404).json({ success: false, message: 'Member not found in group' });
    }

    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: requesterId,
        community_id: communityGroup.community_id
      }
    });

    const isCommunityOwner = communityMembership?.role === 'Owner';
    const isGroupDirector = requesterMember && requesterMember.role === 'Director';

    // Only Community Owner or Group Director can promote/demote group Admins
    if (!isCommunityOwner && !isGroupDirector) {
      return res.status(403).json({ success: false, message: 'Access denied: Only group Creator/Director or Community Owner can manage roles' });
    }

    if (targetMember.role === 'Director') {
      return res.status(400).json({ success: false, message: 'Cannot modify the group Director\'s role' });
    }

    await prisma.conversationMember.update({
      where: { id: targetMember.id },
      data: { role: newRole }
    });

    const updatedConv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: getConversationInclude()
    });

    // Notify Pusher channel
    pusher.trigger(`conversation-${conversationId}`, 'member-role-updated', {
      userId: targetUserId,
      role: newRole,
      conversationId
    });

    // Notify all member channels
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      const memberTransformed = transformConversation(updatedConv, member.user_id);
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', memberTransformed);
    }

    return res.json({ success: true, message: `Member successfully updated to ${newRole}` });
  } catch (error) {
    console.error('Update member role error:', error.message);
    res.status(500).json({ success: false, message: 'Could not update member role' });
  }
});

/**
 * GET /api/chat/conversations/:id/join-requests
 * Fetch all pending join requests for a group
 */
router.get('/conversations/:id/join-requests', authenticateUser, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Verify user is group admin/owner
    const myMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        community_id: communityGroup.community_id
      }
    });

    const isCommunityAdmin = communityMembership?.role === 'Owner' || communityMembership?.role === 'Moderator';
    const isGroupAdmin = myMember && (myMember.role === 'Admin' || myMember.role === 'Director');

    if (!isCommunityAdmin && !isGroupAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied: Admin privileges required' });
    }

    const requests = await prisma.groupJoinRequest.findMany({
      where: {
        group_id: communityGroup.id,
        status: 'PENDING'
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar_url: true,
            role: true
          }
        }
      }
    });

    return res.json({ success: true, data: requests });
  } catch (error) {
    console.error('Fetch join requests error:', error.message);
    res.status(500).json({ success: false, message: 'Could not fetch join requests' });
  }
});

/**
 * POST /api/chat/conversations/:id/join-requests/:requestId/approve
 * Approve a pending join request
 */
router.post('/conversations/:id/join-requests/:requestId/approve', authenticateUser, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const userId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Verify permissions
    const myMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        community_id: communityGroup.community_id
      }
    });

    const isCommunityAdmin = communityMembership?.role === 'Owner' || communityMembership?.role === 'Moderator';
    const isGroupAdmin = myMember && (myMember.role === 'Admin' || myMember.role === 'Director');

    if (!isCommunityAdmin && !isGroupAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Find join request
    const joinRequest = await prisma.groupJoinRequest.findFirst({
      where: {
        id: requestId,
        group_id: communityGroup.id
      }
    });

    if (!joinRequest) {
      return res.status(404).json({ success: false, message: 'Join request not found' });
    }

    // Add user to group conversation
    await prisma.conversationMember.create({
      data: {
        conversation_id: conversationId,
        user_id: joinRequest.user_id,
        role: 'Member'
      }
    });

    // Delete request
    await prisma.groupJoinRequest.delete({
      where: { id: requestId }
    });

    const updatedConv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: getConversationInclude()
    });

    // Notify Pusher channel
    pusher.trigger(`conversation-${conversationId}`, 'member-joined', {
      userId: joinRequest.user_id,
      conversationId
    });

    pusher.trigger(`conversation-${conversationId}`, 'join-requests-updated', { conversationId });

    // Notify all member channels
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      const memberTransformed = transformConversation(updatedConv, member.user_id);
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', memberTransformed);
    }

    return res.json({ success: true, message: 'Join request approved' });
  } catch (error) {
    console.error('Approve join request error:', error.message);
    res.status(500).json({ success: false, message: 'Could not approve join request' });
  }
});

/**
 * POST /api/chat/conversations/:id/join-requests/:requestId/reject
 * Reject a pending join request
 */
router.post('/conversations/:id/join-requests/:requestId/reject', authenticateUser, async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const requestId = Number(req.params.requestId);
    const userId = Number(req.user.id);

    const communityGroup = await prisma.communityGroup.findFirst({
      where: { conversation_id: conversationId }
    });

    if (!communityGroup) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    // Verify permissions
    const myMember = await prisma.conversationMember.findFirst({
      where: {
        conversation_id: conversationId,
        user_id: userId
      }
    });

    const communityMembership = await prisma.communityMember.findFirst({
      where: {
        user_id: userId,
        community_id: communityGroup.community_id
      }
    });

    const isCommunityAdmin = communityMembership?.role === 'Owner' || communityMembership?.role === 'Moderator';
    const isGroupAdmin = myMember && (myMember.role === 'Admin' || myMember.role === 'Director');

    if (!isCommunityAdmin && !isGroupAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    // Find and delete join request
    const joinRequest = await prisma.groupJoinRequest.findFirst({
      where: {
        id: requestId,
        group_id: communityGroup.id
      }
    });

    if (!joinRequest) {
      return res.status(404).json({ success: false, message: 'Join request not found' });
    }

    await prisma.groupJoinRequest.delete({
      where: { id: requestId }
    });

    pusher.trigger(`conversation-${conversationId}`, 'join-requests-updated', { conversationId });

    return res.json({ success: true, message: 'Join request rejected' });
  } catch (error) {
    console.error('Reject join request error:', error.message);
    res.status(500).json({ success: false, message: 'Could not reject join request' });
  }
});


/**
 * POST /api/pusher/auth
 * Pusher channel authorization endpoint
 * Validates that the authenticated user has permission to access the requested channel
 */
router.post('/pusher/auth', pusherAuthLimiter, authenticateUser, async (req, res) => {
  try {
    const userId = Number(req.user?.id);
    const { socket_id: socketId, channel_name: channelName } = req.body;

    if (!userId || isNaN(userId)) {
      console.warn('[PUSHER_AUTH] Invalid user ID in request:', req.user);
      return res.status(401).json({ success: false, message: 'Invalid session' });
    }

    if (!socketId || !channelName) {
      return res.status(400).json({ success: false, message: 'Missing socket_id or channel_name' });
    }

    // Parse channel name and validate user access
    // Supported channel formats:
    // - conversation-{conversationId} - User must be a member of the conversation
    // - user-{userId} - User can only subscribe to their own user channel
    // - user-{userId}-chats - User can only subscribe to their own chats channel
    // - global-events - Public channel, no authorization required

    if (channelName === 'global-events') {
      // Public channel - allow without additional validation
    } else if (channelName.startsWith('conversation-')) {
      const conversationId = Number(channelName.replace('conversation-', ''));
      
      if (isNaN(conversationId)) {
        return res.status(400).json({ success: false, message: 'Invalid conversation ID in channel name' });
      }

      // Check if user is a member of the conversation
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          members: { some: { user_id: userId } }
        }
      });

      if (!conversation) {
        console.warn(`[PUSHER_AUTH] Access denied for user ${userId} to conversation ${conversationId}`);
        return res.status(403).json({ success: false, message: 'Access denied to this conversation' });
      }

    } else if (channelName.startsWith('user-')) {
      // Extract user ID from channel name
      const channelUserId = Number(channelName.split('-')[1]);
      
      if (isNaN(channelUserId)) {
        return res.status(400).json({ success: false, message: 'Invalid user ID in channel name' });
      }

      // User can only subscribe to their own user channels
      if (channelUserId !== userId) {
        console.warn(`[PUSHER_AUTH] Access denied for user ${userId} to channel ${channelName}`);
        return res.status(403).json({ success: false, message: 'Access denied to this channel' });
      }

    } else {
      // Unsupported channel type
      console.warn(`[PUSHER_AUTH] Unsupported channel type: ${channelName}`);
      return res.status(400).json({ success: false, message: 'Unsupported channel type' });
    }

    // Generate authorization signature
    const authResponse = pusher.authorizeChannel(socketId, channelName);
    
    res.json(authResponse);
  } catch (error) {
    console.error('[PUSHER_AUTH] Authorization error:', error.message);
    res.status(500).json({ success: false, message: 'Authorization failed' });
  }
});

module.exports = router;
