# Tasks & Credits Integration Report | TAKE ONE Nexus

This report documents the architectural configuration and database constraints of the TAKE ONE Nexus tasks and credits system.

## 1. Credit Task Configuration
Tasks are seeded in the database via `utils/seedCreditTasks.js` under the `CreditTask` model.

| Task Trigger | Name | Credits Reward | Description |
| :--- | :--- | :--- | :--- |
| `EMAIL_VERIFICATION` | Email Verification | 150 | Awarded upon verifying email address via OTP. |
| `FIRST_SCRIPT_APPROVAL` | First Script Upload | 500 | Awarded upon the first approved script submission. |

## 2. Transaction Integrity & Idempotency
Credits are awarded using the `awardCreditTask(userId, triggerType)` function inside `utils/seedCreditTasks.js`. To ensure absolute data consistency, all operations execute within a single atomic database transaction:

```js
await prisma.$transaction(async (tx) => {
  // 1. Check if user has already completed this task
  const existing = await tx.userCompletedTask.findFirst({
    where: { user_id: numericUserId, task_id: task.id }
  });
  if (existing) return;

  // 2. Log task completion
  await tx.userCompletedTask.create({ ... });

  // 3. Update user credits balance
  await tx.user.update({ ... });

  // 4. Create credit transaction log
  await tx.creditTransaction.create({ ... });
});
```

This prevents double-awarding credits (idempotency check) and guarantees that either all credit tables update together or none do (atomicity).

## 3. Realtime Updates
Upon successful credit transaction commit, `awardCreditTask` triggers a real-time event via Pusher:

- **Pusher Channel**: `global-events`
- **Pusher Event**: `leaderboard-update`
- **Payload**: `{}` (triggers client-side data refetching)

Any client listening to this event (e.g. `LeaderboardClient.tsx`) will immediately trigger a fetch to the `/api/ratings/leaderboard` endpoint to refresh standings.

## 4. Trigger Integration Points
- **OTP Verification Flow** (`routes/otp.js`): Calls `awardCreditTask(userId, 'EMAIL_VERIFICATION')` upon successful OTP confirmation.
- **Script Review Flow** (`routes/scripts.js`): Calls `awardCreditTask(userId, 'FIRST_SCRIPT_APPROVAL')` upon script review confirmation.
