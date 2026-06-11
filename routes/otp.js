const express = require('express');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { authenticateUser } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/rateLimiter');
const { Resend } = require('resend');

const router = express.Router();

const resend = new Resend(process.env.RESEND_API_KEY);

// Rate limiter: max 3 OTP send attempts per 15 minutes per user
const otpSendLimiter = createRateLimiter({
  limit: 3,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'otp_send',
});

// Rate limiter: max 5 confirm attempts per 15 minutes per user
const otpConfirmLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'otp_confirm',
});

/**
 * Build the neon-styled cinematic OTP email HTML
 */
function buildOtpEmailHtml(name, otp) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Email Verification — TAKE ONE</title>
</head>
<body style="margin:0;padding:0;background:#06080A;font-family:'Courier New',monospace;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06080A;padding:40px 20px;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#0E1218;border:1px solid rgba(255,77,26,0.25);border-radius:12px;overflow:hidden;max-width:560px;width:100%;">

      <!-- Header filmstrip -->
      <tr>
        <td style="background:linear-gradient(135deg,#FF4D1A,#FF7A1A);padding:32px 40px;text-align:center;">
          <div style="font-family:'Courier New',monospace;font-size:28px;font-weight:900;color:#06080A;letter-spacing:8px;">TAKE ONE</div>
          <div style="font-size:10px;color:rgba(6,8,10,0.65);letter-spacing:4px;margin-top:6px;text-transform:uppercase;">Script Platform · Email Verification</div>
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td style="padding:40px;">
          <p style="color:#E8DFC8;font-size:13px;letter-spacing:1px;line-height:1.8;margin:0 0 24px;">
            HEY ${name.toUpperCase()},
          </p>
          <p style="color:rgba(232,223,200,0.65);font-size:12px;letter-spacing:1px;line-height:1.8;margin:0 0 32px;">
            Your verification signal has been received. Enter the one-time access code below to confirm your identity and unlock full platform privileges.
          </p>

          <!-- OTP Block -->
          <div style="background:#13181F;border:1px solid rgba(255,77,26,0.3);border-radius:8px;padding:28px;text-align:center;margin-bottom:32px;box-shadow:0 0 40px rgba(255,77,26,0.08);">
            <div style="font-size:10px;color:#6B7A8D;letter-spacing:4px;text-transform:uppercase;margin-bottom:16px;">ONE-TIME ACCESS CODE</div>
            <div style="font-size:42px;font-weight:900;letter-spacing:16px;color:#FF4D1A;font-family:'Courier New',monospace;text-shadow:0 0 20px rgba(255,77,26,0.5);">${otp}</div>
            <div style="font-size:10px;color:#6B7A8D;letter-spacing:2px;margin-top:16px;">EXPIRES IN 10 MINUTES</div>
          </div>

          <p style="color:rgba(232,223,200,0.4);font-size:10px;letter-spacing:1px;line-height:1.7;margin:0;border-top:1px solid rgba(255,77,26,0.1);padding-top:24px;">
            IF YOU DID NOT REQUEST THIS CODE, IGNORE THIS MESSAGE. DO NOT SHARE THIS CODE WITH ANYONE.<br/>
            TAKE ONE Nexus · Restricted Platform Access
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding:20px 40px;border-top:1px solid rgba(255,77,26,0.1);text-align:center;">
          <div style="font-size:9px;color:#3A4556;letter-spacing:2px;text-transform:uppercase;">
            © ${new Date().getFullYear()} TAKE ONE · takeone-nexus.net.in
          </div>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

/**
 * POST /api/otp/send
 * Generate & send a 6-digit OTP to the authenticated user's email.
 * Enforces 60-second cooldown between sends.
 */
router.post('/send', authenticateUser, otpSendLimiter, async (req, res) => {
  try {
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        email_verified: true,
        verification_token_expires: true,
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.email_verified) {
      return res.status(400).json({ success: false, message: 'Email is already verified' });
    }

    // Enforce 60-second cooldown (check if token was set < 60s ago)
    if (user.verification_token_expires) {
      const expiresAt = new Date(user.verification_token_expires).getTime();
      const tenMinutesFromNow = Date.now() + 10 * 60 * 1000;
      const setAt = expiresAt - 10 * 60 * 1000; // when token was set
      const cooldownEnds = setAt + 60 * 1000;
      if (Date.now() < cooldownEnds) {
        const waitSecs = Math.ceil((cooldownEnds - Date.now()) / 1000);
        return res.status(429).json({
          success: false,
          message: `Please wait ${waitSecs}s before requesting a new code`,
          retryAfter: waitSecs
        });
      }
    }

    // Generate 6-digit OTP and hash it for storage
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await prisma.user.update({
      where: { id: userId },
      data: {
        verification_token: hashedOtp,
        verification_token_expires: expires,
      }
    });

    // Send cinematic OTP email via Resend
    await resend.emails.send({
      from: 'TAKE ONE <noreply@takeone-nexus.net.in>',
      to: user.email,
      subject: `[${otp}] — Your TAKE ONE Verification Code`,
      html: buildOtpEmailHtml(user.name, otp),
    });

    console.log(`[OTP] Code dispatched to ${user.email}`);
    return res.json({ success: true, message: 'Verification code sent to your email' });

  } catch (error) {
    console.error('[OTP_SEND_ERROR]', error.message);
    return res.status(500).json({ success: false, message: 'Failed to send verification code' });
  }
});

/**
 * POST /api/otp/confirm
 * Verify submitted 6-digit OTP and mark email as verified.
 * On success, triggers the 'verify_email' credit task reward.
 */
router.post('/confirm', authenticateUser, otpConfirmLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const { otp } = req.body;

    if (!otp || String(otp).length !== 6) {
      return res.status(400).json({ success: false, message: 'A valid 6-digit code is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email_verified: true,
        verification_token: true,
        verification_token_expires: true,
        credits: true,
      }
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.email_verified) return res.status(400).json({ success: false, message: 'Email is already verified' });

    if (!user.verification_token || !user.verification_token_expires) {
      return res.status(400).json({ success: false, message: 'No verification code found. Please request a new one.' });
    }

    if (new Date() > new Date(user.verification_token_expires)) {
      return res.status(400).json({ success: false, message: 'Verification code has expired. Please request a new one.' });
    }

    // Hash submitted OTP and compare
    const hashedOtp = crypto.createHash('sha256').update(String(otp)).digest('hex');
    if (hashedOtp !== user.verification_token) {
      return res.status(400).json({ success: false, message: 'Invalid verification code' });
    }

    // Mark email as verified and clear the token
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        email_verified: true,
        email_verified_at: new Date(),
        verification_token: null,
        verification_token_expires: null,
      },
      select: {
        id: true,
        email: true,
        role: true,
        secondary_role: true,
        email_verified: true
      }
    });

    // Generate new token & set cookie immediately
    try {
      const { createToken, getCookieOptions } = require('./users');
      const token = createToken(updatedUser);
      res.cookie('token', token, getCookieOptions());
    } catch (cookieErr) {
      console.error('[OTP] Failed to update cookie after verification:', cookieErr.message);
    }

    // Trigger credit reward for 'verify_email' task (non-blocking)
    triggerCreditTask(userId, 'verify_email').catch(err =>
      console.error('[OTP_CREDIT_TRIGGER_ERROR]', err.message)
    );

    return res.json({ success: true, message: 'Email verified successfully! Credits awarded.' });

  } catch (error) {
    console.error('[OTP_CONFIRM_ERROR]', error.message);
    return res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

/**
 * Award credits for a named credit task trigger (e.g. 'verify_email').
 * Idempotent — only awards once per user per task.
 */
async function triggerCreditTask(userId, triggerType) {
  try {
    const task = await prisma.creditTask.findFirst({
      where: { trigger_type: triggerType, is_active: true }
    });

    if (!task) return; // Task not configured

    // Idempotency check — don't double-award
    const existing = await prisma.userCompletedTask.findFirst({
      where: { user_id: userId, task_id: task.id }
    });
    if (existing) return;

    // Award credits atomically
    await prisma.$transaction([
      prisma.userCompletedTask.create({
        data: {
          user_id: userId,
          task_id: task.id,
          credits_awarded: task.credits_rewarded,
        }
      }),
      prisma.user.update({
        where: { id: userId },
        data: { credits: { increment: task.credits_rewarded } }
      }),
      prisma.creditTransaction.create({
        data: {
          user_id: userId,
          amount: task.credits_rewarded,
          type: 'CREDIT',
          reason: `Task reward: ${task.name}`,
        }
      })
    ]);

    console.log(`[CREDITS] +${task.credits_rewarded} awarded to user ${userId} for '${triggerType}'`);
  } catch (err) {
    console.error('[CREDIT_TASK_ERROR]', err.message);
  }
}

module.exports = router;
module.exports.triggerCreditTask = triggerCreditTask;
