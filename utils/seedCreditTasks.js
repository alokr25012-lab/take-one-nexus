const prisma = require('./prisma');
const Pusher = require('pusher');

// Configure Pusher
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID || '',
  key: process.env.NEXT_PUBLIC_PUSHER_KEY || '',
  secret: process.env.PUSHER_SECRET || '',
  cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || '',
  useTLS: true
});

async function seedCreditTasks() {
  try {
    console.log('[SEED_CREDITS] Seeding default credit tasks...');

    const defaultTasks = [
      {
        trigger_type: 'EMAIL_VERIFICATION',
        name: 'Email Verification',
        description: 'Verify your email to secure your account and unlock dynamic Nexus features.',
        credits_rewarded: 150,
        is_active: true
      },
      {
        trigger_type: 'FIRST_SCRIPT_APPROVAL',
        name: 'First Approved Script',
        description: 'Upload a high-fidelity script and pass our cinematic moderation panel.',
        credits_rewarded: 500,
        is_active: true
      }
    ];

    for (const t of defaultTasks) {
      // Upsert by trigger_type
      const existing = await prisma.creditTask.findFirst({
        where: { trigger_type: t.trigger_type }
      });

      if (existing) {
        // Update reward values if they changed, but keep name/description/status
        await prisma.creditTask.update({
          where: { id: existing.id },
          data: {
            credits_rewarded: t.credits_rewarded,
            name: existing.name || t.name,
            description: existing.description || t.description
          }
        });
      } else {
        await prisma.creditTask.create({
          data: t
        });
        console.log(`[SEED_CREDITS] Created credit task for ${t.trigger_type}`);
      }
    }

    console.log('[SEED_CREDITS] Default credit tasks successfully seeded.');
  } catch (error) {
    console.error('[SEED_CREDITS_ERROR] Failed to seed credit tasks:', error.message);
  }
}

/**
 * Award credits to a user for completing a credit task
 * Prevents duplicate completion.
 */
async function awardCreditTask(userId, triggerType) {
  try {
    const numericUserId = Number(userId);
    if (Number.isNaN(numericUserId)) return;

    // Find the task
    const task = await prisma.creditTask.findFirst({
      where: { trigger_type: triggerType, is_active: true }
    });

    if (!task) {
      console.log(`[CREDITS_AWARD] No active credit task found for trigger type: ${triggerType}`);
      return;
    }

    // Check if already completed
    const existingCompletion = await prisma.userCompletedTask.findFirst({
      where: {
        user_id: numericUserId,
        task_id: task.id
      }
    });

    if (existingCompletion) {
      console.log(`[CREDITS_AWARD] User ${numericUserId} already completed task ${task.id} (${triggerType})`);
      return;
    }

    // Use transaction to ensure consistency
    await prisma.$transaction(async (tx) => {
      // Mark as completed
      await tx.userCompletedTask.create({
        data: {
          user_id: numericUserId,
          task_id: task.id,
          credits_awarded: task.credits_rewarded
        }
      });

      // Update user credits
      await tx.user.update({
        where: { id: numericUserId },
        data: {
          credits: {
            increment: task.credits_rewarded
          }
        }
      });

      // Record transaction
      await tx.creditTransaction.create({
        data: {
          user_id: numericUserId,
          amount: task.credits_rewarded,
          type: 'CREDIT',
          reason: `Reward: ${task.name}`
        }
      });
    });

    console.log(`[CREDITS_AWARD] Successfully rewarded ${task.credits_rewarded} credits to user ${numericUserId} for ${triggerType}`);

    // Broadcast update via Pusher
    pusher.trigger('global-events', 'leaderboard-update', {});
  } catch (error) {
    console.error(`[CREDITS_AWARD_ERROR] Failed to award credits for ${triggerType}:`, error.message);
  }
}

module.exports = { seedCreditTasks, awardCreditTask };
