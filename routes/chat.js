const express = require('express');
const { authenticateUser } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middleware/validator');
const prisma = require('../utils/prisma');
const Pusher = require('pusher');
const { formatDisplayName } = require('../utils/formatting');


const router = express.Router();

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
  return {
    ...c,
    my_role: myMember ? myMember.role : 'Member',
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
  validateRequest
];

router.post('/messages', authenticateUser, messageValidation, async (req, res) => {
  try {
    const { conversationId, content, recipientId } = req.body;
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
      data: message
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
 * Clear all messages in a conversation
 */
router.post('/conversations/:id/clear', authenticateUser, [
  param('id').isNumeric(),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);

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

    // Delete messages
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
 * PATCH /api/chat/conversations/:id/avatar
 * Update group conversation avatar
 */
router.patch('/conversations/:id/avatar', authenticateUser, [
  param('id').isNumeric(),
  body('avatarUrl').trim().notEmpty().withMessage('avatarUrl is required'),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.id);
    const userId = Number(req.user.id);
    const { avatarUrl } = req.body;

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
      return res.status(400).json({ success: false, message: 'Can only update group avatars' });
    }

    // Update conversation avatar
    const updatedConversation = await prisma.conversation.update({
      where: { id: conversationId },
      data: { avatar_url: avatarUrl },
      include: getConversationInclude()
    });

    const transformed = transformConversation(updatedConversation, userId);

    // Broadcast the update via Pusher
    pusher.trigger(`conversation-${conversationId}`, 'avatar-updated', {
      conversationId,
      avatar_url: avatarUrl
    });

    // Also notify all member channels
    const members = await prisma.conversationMember.findMany({
      where: { conversation_id: conversationId },
      select: { user_id: true }
    });

    for (const member of members) {
      pusher.trigger(`user-${member.user_id}-chats`, 'conversation-update', transformed);
    }

    res.json({ success: true, data: transformed });
  } catch (error) {
    console.error('Update avatar error:', error.message);
    res.status(500).json({ success: false, message: 'Could not update group avatar' });
  }
});


module.exports = router;
