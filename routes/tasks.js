const express = require('express');
const { authenticateUser, requireVerified, requireAdmin } = require('../middleware/auth');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validator');
const { createRateLimiter } = require('../middleware/rateLimiter');
const prisma = require('../utils/prisma');
const Pusher = require('pusher');


const router = express.Router();

const taskLimiter = createRateLimiter({
  limit: 100, // 100 requests per 15 mins
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'tasks'
});


// Configure Pusher (only if credentials are provided)
let pusher = null;
if (process.env.PUSHER_APP_ID && process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.PUSHER_SECRET) {
  pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.NEXT_PUBLIC_PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'ap2',
    useTLS: true
  });
}

// Helper function to safely trigger Pusher events
async function safePusherTrigger(channel, event, data) {
  if (!pusher) return;
  try {
    await pusher.trigger(channel, event, data);
  } catch (error) {
    console.warn('[PUSHER] Failed to trigger event:', error.message);
  }
}

const adminTaskValidation = [
  body('title').trim().notEmpty().withMessage('Task title is required').isLength({ max: 255 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('credits').isInt({ min: 0 }).withMessage('Credits reward must be zero or higher'),
  body('category').trim().notEmpty().withMessage('Category is required').isLength({ max: 100 }),
  body('active').optional().isBoolean().withMessage('Active must be true or false'),
  validateRequest
];

/**
 * GET /api/tasks/admin/definitions
 * Admin-only: list platform task definitions from credit_tasks table.
 */
router.get('/admin/definitions', authenticateUser, requireVerified, requireAdmin, taskLimiter, async (req, res) => {
  try {
    const tasks = await prisma.creditTask.findMany({
      orderBy: { created_at: 'desc' },
      include: {
        completed_by: {
          select: { 
            id: true, 
            user_id: true, 
            credits_awarded: true, 
            completed_at: true 
          }
        }
      }
    });

    const mappedTasks = tasks.map(t => ({
      ...t,
      title: t.name,
      credits: t.credits_rewarded,
      active: t.is_active,
      category: t.trigger_type.replace('ADMIN_', '').toLowerCase()
    }));

    res.json({ success: true, data: mappedTasks });
  } catch (error) {
    console.error('Admin task list error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load admin tasks' });
  }
});

/**
 * POST /api/tasks/admin/definitions
 * Admin-only: create platform task definitions.
 * Creates tasks in the credit_tasks table so they appear on the Leaderboard.
 */
router.post('/admin/definitions', authenticateUser, requireVerified, requireAdmin, taskLimiter, adminTaskValidation, async (req, res) => {
  try {
    const { title, description, credits, category, active = true } = req.body;

    // Create task in credit_tasks table (for Leaderboard)
    const creditTask = await prisma.creditTask.create({
      data: {
        name: title.trim(),
        description: description?.trim() || null,
        credits_rewarded: Number(credits),
        is_active: Boolean(active),
        trigger_type: `ADMIN_${category.trim().toUpperCase().replace(/\s+/g, '_')}`
      }
    });

    const mappedTask = {
      ...creditTask,
      title: creditTask.name,
      credits: creditTask.credits_rewarded,
      active: creditTask.is_active,
      category: creditTask.trigger_type.replace('ADMIN_', '').toLowerCase()
    };

    if (pusher) {
      await safePusherTrigger('admin-dashboard', 'update', {
        type: 'ADMIN_TASK_CREATED',
        task: mappedTask
      });
    }

    res.status(201).json({ success: true, data: mappedTask });
  } catch (error) {
    console.error('Admin task create error:', error.message);
    res.status(500).json({ success: false, message: 'Could not create task' });
  }
});

/**
 * PUT /api/tasks/admin/definitions/:id
 * Admin-only: update platform task definitions.
 */
router.put('/admin/definitions/:id', authenticateUser, requireVerified, requireAdmin, taskLimiter, [
  param('id').isNumeric().withMessage('Invalid task ID'),
  ...adminTaskValidation
], async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const { title, description, credits, category, active = true } = req.body;

    const taskExists = await prisma.creditTask.findUnique({
      where: { id: taskId }
    });

    if (!taskExists) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    const updatedTask = await prisma.creditTask.update({
      where: { id: taskId },
      data: {
        name: title.trim(),
        description: description?.trim() || null,
        credits_rewarded: Number(credits),
        is_active: Boolean(active),
        trigger_type: `ADMIN_${category.trim().toUpperCase().replace(/\s+/g, '_')}`
      }
    });

    const mappedTask = {
      ...updatedTask,
      title: updatedTask.name,
      credits: updatedTask.credits_rewarded,
      active: updatedTask.is_active,
      category: updatedTask.trigger_type.replace('ADMIN_', '').toLowerCase()
    };

    if (pusher) {
      await safePusherTrigger('admin-dashboard', 'update', {
        type: 'ADMIN_TASK_UPDATED',
        task: mappedTask
      });
    }

    res.json({ success: true, data: mappedTask });
  } catch (error) {
    console.error('Admin task update error:', error.message);
    res.status(500).json({ success: false, message: 'Could not update task' });
  }
});

/**
 * GET /api/tasks/admin/submissions
 * Admin-only: review task submissions.
 */
router.get('/admin/submissions', authenticateUser, requireVerified, requireAdmin, taskLimiter, async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page)  || 1);
    const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
    const skip  = (page - 1) * limit;

    const [submissions, total] = await prisma.$transaction([
      prisma.taskSubmission.findMany({
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
        include: {
          task: true,
          user: {
            select: { id: true, name: true, email: true, credits: true }
          }
        }
      }),
      prisma.taskSubmission.count()
    ]);

    res.json({
      success: true,
      data: submissions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Admin task submissions error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load task submissions' });
  }
});

/**
 * POST /api/tasks/admin/submissions/:id/approve
 * Admin-only: approve task and allot credits manually.
 */
router.post('/admin/submissions/:id/approve', authenticateUser, requireVerified, requireAdmin, taskLimiter, [
  param('id').isNumeric().withMessage('Invalid submission ID'),
  body('credits').optional().isInt({ min: 0 }).withMessage('Credits must be zero or higher'),
  validateRequest
], async (req, res) => {
  try {
    const submissionId = Number(req.params.id);

    const submission = await prisma.taskSubmission.findUnique({
      where: { id: submissionId },
      include: { task: true }
    });

    if (!submission) {
      return res.status(404).json({ success: false, message: 'Task submission not found' });
    }

    if (submission.status === 'approved') {
      return res.status(400).json({ success: false, message: 'Task submission is already approved' });
    }

    const credits = Number(req.body.credits ?? submission.task.credits ?? submission.task.reward_credits ?? 0);

    const [, updatedUser, transaction] = await prisma.$transaction([
      prisma.taskSubmission.update({
        where: { id: submissionId },
        data: {
          status: 'approved',
          credits_awarded: credits
        }
      }),
      prisma.user.update({
        where: { id: submission.user_id },
        data: { credits: { increment: credits } }
      }),
      prisma.creditTransaction.create({
        data: {
          user_id: submission.user_id,
          amount: credits,
          reason: `Task Approved: ${submission.task.title}`,
          type: 'CREDIT'
        }
      })
    ]);

    if (pusher) {
      await safePusherTrigger(`user-${submission.user_id}`, 'credit-update', {
        credits: updatedUser.credits,
        change: credits,
        reason: submission.task.title
      });
      await safePusherTrigger('global-events', 'leaderboard-update', {});
      await safePusherTrigger('admin-dashboard', 'update', {
        type: 'ADMIN_TASK_APPROVED',
        submissionId,
        transactionId: transaction.id
      });
    }

    res.json({ success: true, message: 'Task approved and credits awarded' });
  } catch (error) {
    console.error('Admin task approve error:', error.message);
    res.status(500).json({ success: false, message: 'Could not approve task submission' });
  }
});

/**
 * POST /api/tasks/admin/submissions/:id/reject
 * Admin-only: reject task submission.
 */
router.post('/admin/submissions/:id/reject', authenticateUser, requireVerified, requireAdmin, taskLimiter, [
  param('id').isNumeric().withMessage('Invalid submission ID'),
  validateRequest
], async (req, res) => {
  try {
    const submissionId = Number(req.params.id);
    const submission = await prisma.taskSubmission.update({
      where: { id: submissionId },
      data: { status: 'rejected', credits_awarded: 0 }
    });

    if (pusher) {
      await safePusherTrigger('admin-dashboard', 'update', {
        type: 'ADMIN_TASK_REJECTED',
        submissionId
      });
    }

    res.json({ success: true, data: submission });
  } catch (error) {
    console.error('Admin task reject error:', error.message);
    res.status(500).json({ success: false, message: 'Could not reject task submission' });
  }
});

/**
 * GET /api/tasks/:conversationId
 * Get all tasks for a conversation
 */
router.get('/:conversationId', authenticateUser, requireVerified, taskLimiter, [
  param('conversationId').isNumeric().withMessage('Invalid conversation ID'),
  validateRequest
], async (req, res) => {
  try {
    const conversationId = Number(req.params.conversationId);
    const userId = Number(req.user.id);

    // Check if user is part of the conversation
    const isMember = await prisma.conversationMember.findUnique({
      where: {
        conversation_id_user_id: {
          conversation_id: conversationId,
          user_id: userId
        }
      }
    });

    if (!isMember) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const tasks = await prisma.task.findMany({
      where: { conversation_id: conversationId },
      orderBy: { created_at: 'desc' }
    });

    res.json({ success: true, data: tasks });
  } catch (error) {
    console.error('Fetch tasks error:', error.message);
    res.status(500).json({ success: false, message: 'Could not load tasks' });
  }
});

/**
 * POST /api/tasks
 * Create a new task
 */
const taskCreateValidation = [
  body('conversationId').isNumeric().withMessage('Conversation ID is required'),
  body('title').trim().notEmpty().withMessage('Title is required').isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('priority').optional().isIn(['Low', 'Medium', 'High', 'Critical']).withMessage('Invalid priority'),
  body('assigneeId').optional({ nullable: true }).isNumeric(),
  body('dueDate').optional({ nullable: true }).isISO8601().withMessage('Invalid date format'),
  body('rewardCredits').optional().isNumeric().withMessage('Credits must be a number'),
  validateRequest
];

const taskCreateLimiter = createRateLimiter({
  limit: 30,
  windowMs: 15 * 60 * 1000, // 15 mins
  keyPrefix: 'task-create'
});


router.post('/', authenticateUser, requireVerified, taskCreateLimiter, taskCreateValidation, async (req, res) => {
  try {
    const { conversationId, title, description, priority, assigneeId, dueDate, rewardCredits } = req.body;
    const userId = Number(req.user.id);

    // Fetch conversation and member info
    const [conversation, member] = await Promise.all([
      prisma.conversation.findUnique({
        where: { id: Number(conversationId) }
      }),
      prisma.conversationMember.findUnique({
        where: {
          conversation_id_user_id: {
            conversation_id: Number(conversationId),
            user_id: userId
          }
        }
      })
    ]);

    if (!conversation || !member) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // Permission Check: 
    // - Always allowed in DMs
    // - In Groups: Only Admin, Director, or Developer (Global or Member role)
    const isLead = !conversation.is_group || 
                   req.user.role === 'Admin' || 
                   ['admin', 'founder'].includes(String(req.user.secondary_role || '').toLowerCase()) || 
                   ['Director', 'Admin'].includes(member.role);

    if (!isLead) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only leaders can assign missions in group chats.' });
    }

    const task = await prisma.task.create({
      data: {
        conversation_id: Number(conversationId),
        creator_id: userId,
        assignee_id: assigneeId ? Number(assigneeId) : null,
        title: title.trim(),
        description: description?.trim() || null,
        priority: priority || 'Medium',
        due_date: dueDate ? new Date(dueDate) : null,
        reward_credits: rewardCredits ? Number(rewardCredits) : 0
      }
    });

    // Trigger Pusher update
    if (pusher) {
      await safePusherTrigger(`conversation-${conversationId}`, 'task-update', {
        type: 'TASK_CREATED',
        task
      });
    }

    res.status(201).json({ success: true, data: task });
  } catch (error) {
    console.error('Create task error:', error.message);
    res.status(500).json({ success: false, message: 'Could not create task' });
  }
});

/**
 * PATCH /api/tasks/:id
 * Update task status or details
 */
const taskUpdateValidation = [
  param('id').isNumeric().withMessage('Invalid task ID'),
  body('status').optional().isIn(['Pending', 'In Progress', 'In Review', 'Done', 'Cancelled']),
  body('priority').optional().isIn(['Low', 'Medium', 'High', 'Critical']),
  body('title').optional().trim().notEmpty().isLength({ max: 200 }),
  body('description').optional().trim().isLength({ max: 2000 }),
  body('assigneeId').optional({ nullable: true }).isNumeric(),
  body('dueDate').optional({ nullable: true }).isISO8601(),
  validateRequest
];

router.patch('/:id', authenticateUser, requireVerified, taskLimiter, taskUpdateValidation, async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const userId = Number(req.user.id);
    const { status, priority, title, description, assigneeId, dueDate } = req.body;

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { conversation: true }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Check if user is member of the conversation
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversation_id_user_id: {
          conversation_id: task.conversation_id,
          user_id: userId
        }
      }
    });

    if (!member) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const isCreator = task.creator_id === userId;
    const isAdmin = req.user.role === 'Admin' || ['admin', 'founder'].includes(String(req.user.secondary_role || '').toLowerCase());
    const isAssignee = task.assignee_id === userId;

    if (!isCreator && !isAdmin && !isAssignee && status) {
       return res.status(403).json({ success: false, message: 'You are not authorized to update this task status.' });
    }

    if (!isCreator && !isAdmin && (priority || title || description || assigneeId || dueDate)) {
      return res.status(403).json({ success: false, message: 'Only the mission creator or an Admin can modify mission details.' });
    }

    const updatedTask = await prisma.task.update({
      where: { id: taskId },
      data: {
        ...(status && { status }),
        ...(priority && (isCreator || isAdmin) && { priority }),
        ...(title && (isCreator || isAdmin) && { title: title.trim() }),
        ...(description !== undefined && (isCreator || isAdmin) && { description: description?.trim() || null }),
        ...(assigneeId !== undefined && (isCreator || isAdmin) && { assignee_id: assigneeId ? Number(assigneeId) : null }),
        ...(dueDate !== undefined && (isCreator || isAdmin) && { due_date: dueDate ? new Date(dueDate) : null }),
        ...(status === 'Done' && { completed_at: new Date() })
      }
    });

    // Trigger Pusher update
    if (pusher) {
      await safePusherTrigger(`conversation-${task.conversation_id}`, 'task-update', {
        type: 'TASK_UPDATED',
        task: updatedTask
      });
    }

    res.json({ success: true, data: updatedTask });
  } catch (error) {
    console.error('Update task error:', error.message);
    res.status(500).json({ success: false, message: 'Could not update task' });
  }
});

/**
 * DELETE /api/tasks/:id
 * Delete a task
 */
router.delete('/:id', authenticateUser, requireVerified, taskLimiter, [
  param('id').isNumeric().withMessage('Invalid task ID'),
  validateRequest
], async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const userId = Number(req.user.id);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { conversation: true }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    // Check if user is member of conversation
    const member = await prisma.conversationMember.findUnique({
      where: {
        conversation_id_user_id: {
          conversation_id: task.conversation_id,
          user_id: userId
        }
      }
    });

    if (!member) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const isCreator = task.creator_id === userId;
    const isAdmin = req.user.role === 'Admin' || ['admin', 'founder'].includes(String(req.user.secondary_role || '').toLowerCase());

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only the mission creator or an Admin can delete missions.' });
    }

    await prisma.task.delete({
      where: { id: taskId }
    });

    // Trigger Pusher update
    if (pusher) {
      await safePusherTrigger(`conversation-${task.conversation_id}`, 'task-update', {
        type: 'TASK_DELETED',
        taskId
      });
    }

    res.json({ success: true, message: 'Task deleted' });
  } catch (error) {
    console.error('Delete task error:', error.message);
    res.status(500).json({ success: false, message: 'Could not delete task' });
  }
});

/**
 * POST /api/tasks/:id/approve
 * Approve a completed task and award credits
 */
router.post('/:id/approve', authenticateUser, requireVerified, taskLimiter, [
  param('id').isNumeric().withMessage('Invalid task ID'),
  validateRequest
], async (req, res) => {
  try {
    const taskId = Number(req.params.id);
    const userId = Number(req.user.id);

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { conversation: true }
    });

    if (!task) {
      return res.status(404).json({ success: false, message: 'Task not found' });
    }

    if (task.status !== 'Done') {
      return res.status(400).json({ success: false, message: 'Only completed tasks can be approved.' });
    }

    if (task.approval_status === 'Approved') {
      return res.status(400).json({ success: false, message: 'Task is already approved.' });
    }

    // Check if user is authorized to approve: only creator or admin
    const isCreator = task.creator_id === userId;
    const isAdmin = req.user.role === 'Admin' || ['admin', 'founder'].includes(String(req.user.secondary_role || '').toLowerCase());

    if (!isCreator && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Unauthorized. Only the mission creator can approve missions and grant rewards.' });
    }

    // Update task and award credits in a transaction
    const [updatedTask, updatedUser] = await prisma.$transaction([
      prisma.task.update({
        where: { id: taskId },
        data: {
          approval_status: 'Approved',
          approved_at: new Date()
        }
      }),
      ...(task.assignee_id && task.reward_credits > 0 ? [
        prisma.user.update({
          where: { id: task.assignee_id },
          data: {
            credits: { increment: task.reward_credits }
          }
        }),
        prisma.creditTransaction.create({
          data: {
            user_id: task.assignee_id,
            amount: task.reward_credits,
            reason: `Task Completed: ${task.title}`,
            type: 'CREDIT'
          }
        })
      ] : [])
    ]);

    // Trigger Pusher update for conversation
    if (pusher) {
      await safePusherTrigger(`conversation-${task.conversation_id}`, 'task-update', {
        type: 'TASK_UPDATED',
        task: updatedTask
      });

      // Trigger update for specific user's credits if assigned
      if (task.assignee_id && task.reward_credits > 0) {
        await safePusherTrigger(`user-${task.assignee_id}`, 'credit-update', {
          credits: updatedUser.credits,
          change: task.reward_credits,
          reason: task.title
        });
      }
      
      // Global leaderboard update trigger
      await safePusherTrigger('global-events', 'leaderboard-update', {});
    }

    res.json({ 
      success: true, 
      message: 'Task approved and rewards granted.',
      data: updatedTask 
    });
  } catch (error) {
    console.error('Approve task error:', error.message);
    res.status(500).json({ success: false, message: 'Could not approve task' });
  }
});

module.exports = router;
