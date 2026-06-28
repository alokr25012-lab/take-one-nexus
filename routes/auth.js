const express = require('express');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { Resend } = require('resend');
const { createRateLimiter, authLimiter } = require('../middleware/rateLimiter');
const { captureError } = require('../src/lib/sentry');

const router = express.Router();

// Initialize Resend
if (!process.env.RESEND_API_KEY) {
  console.warn('[AUTH] WARNING: RESEND_API_KEY not configured. Password reset emails will not be sent.');
}
const resend = new Resend(process.env.RESEND_API_KEY);

// Rate limiter for forgot password
const forgotPasswordLimiter = createRateLimiter({
  limit: 3,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: 'forgot-password'
});

// Rate limiter for reset password.
// Without this, an attacker can enumerate reset tokens via brute force at
// unlimited speed. The window and limit mirror the forgot-password limiter
// for consistent protection across the password-reset flow.
const resetPasswordLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
  keyPrefix: 'reset-password'
});

/**
 * Helper function to generate secure reset token
 */
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Helper function to hash token for storage
 */
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Helper function to get reset token expiry (1 hour from now)
 */
function getResetExpiry() {
  return new Date(Date.now() + 60 * 60 * 1000);
}

/**
 * Helper function to build reset password email template
 */
function buildResetPasswordTemplate({ userName, resetUrl, expiresInMinutes }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password</title>
      <style>
        body {
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          background-color: #0a0c10;
          color: #e0e0e0;
          margin: 0;
          padding: 20px;
        }
        .container {
          max-width: 600px;
          margin: 0 auto;
          background-color: #14161a;
          border-radius: 8px;
          overflow: hidden;
          border: 1px solid #ff4d1a;
        }
        .header {
          background: linear-gradient(135deg, #ff4d1a 0%, #ff6a42 100%);
          padding: 30px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          color: #06080a;
          font-size: 24px;
          text-transform: uppercase;
          letter-spacing: 2px;
        }
        .content {
          padding: 30px;
        }
        .content p {
          line-height: 1.6;
          margin-bottom: 20px;
        }
        .button {
          display: inline-block;
          background-color: #ff4d1a;
          color: #06080a;
          padding: 15px 30px;
          text-decoration: none;
          border-radius: 4px;
          font-weight: bold;
          text-transform: uppercase;
          letter-spacing: 1px;
          margin: 20px 0;
        }
        .button:hover {
          background-color: #ff6a42;
        }
        .footer {
          background-color: #0a0c10;
          padding: 20px;
          text-align: center;
          font-size: 12px;
          color: #888;
        }
        .warning {
          color: #ff6a42;
          font-size: 12px;
          margin-top: 20px;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Take One Nexus</h1>
        </div>
        <div class="content">
          <p>Hello ${userName},</p>
          <p>We received a request to reset your password for your Take One Nexus account.</p>
          <p>Click the button below to reset your password:</p>
          <center>
            <a href="${resetUrl}" class="button">Reset Password</a>
          </center>
          <p>This link will expire in ${expiresInMinutes} minutes.</p>
          <p class="warning">If you didn't request this password reset, please ignore this email and your password will remain unchanged.</p>
        </div>
        <div class="footer">
          <p>© 2026 Take One Nexus. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * POST /api/auth/forgot-password
 * Generates a password reset token and sends reset email.
 */
router.post('/forgot-password', authLimiter, forgotPasswordLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const normalizedEmail = email?.trim().toLowerCase();

    if (!normalizedEmail) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true }
    });

    // Always return success to prevent email enumeration attacks
    if (!user) {
      return res.json({
        success: true,
        message: 'If this email is registered, a reset link has been sent.'
      });
    }

    // Generate reset token
    const token = generateSecureToken();
    const hashedToken = hashToken(token);
    const expiry = getResetExpiry();

    // Update user with reset token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        reset_token: hashedToken,
        reset_token_expires: expiry
      }
    });

    // Build reset URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://takeone-nexus.net.in';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    // Send reset email
    try {
      if (!process.env.RESEND_API_KEY) {
        console.error('[Forgot Password] Cannot send email: RESEND_API_KEY not configured');
        console.error('[Forgot Password] Please set RESEND_API_KEY in your .env file');
      } else {
        console.log('[Forgot Password] RESEND_API_KEY is configured');
        console.log('[Forgot Password] Sending reset email to:', user.email);
        console.log('[Forgot Password] Reset URL:', resetUrl);
        const result = await resend.emails.send({
          from: 'TAKE ONE NEXUS <onboarding@takeone-nexus.net.in>',
          to: user.email,
          subject: '🔐 Reset your TAKE ONE password',
          html: buildResetPasswordTemplate({
            userName: user.name,
            resetUrl,
            expiresInMinutes: 60
          })
        });
        console.log('[Forgot Password] Email sent successfully');
        console.log('[Forgot Password] Resend response:', JSON.stringify(result, null, 2));
      }
    } catch (emailError) {
      console.error('[Forgot Password] Email send failed:', emailError.message);
      console.error('[Forgot Password] Full error details:', JSON.stringify(emailError, null, 2));
      console.error('[Forgot Password] Error name:', emailError.name);
      console.error('[Forgot Password] Error stack:', emailError.stack);
      captureError(emailError, { endpoint: 'POST /api/auth/forgot-password', action: 'send_reset_email' });
      // Still return success to prevent email enumeration
    }

    return res.json({
      success: true,
      message: 'If this email is registered, a reset link has been sent.'
    });
  } catch (error) {
    console.error('[Forgot Password] Error:', error.message);
    captureError(error, { endpoint: 'POST /api/auth/forgot-password', action: 'forgot_password' });
    
    // Always return success message to prevent email enumeration
    return res.json({
      success: true,
      message: 'If this email is registered, a reset link has been sent.'
    });
  }
});

/**
 * POST /api/auth/reset-password
 * Resets user password using valid token
 */
router.post('/reset-password', authLimiter, resetPasswordLimiter, async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({
        success: false,
        message: 'Token and password are required'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters'
      });
    }

    // Hash the token to compare with stored hash
    const hashedToken = hashToken(token);

    // Find user with valid reset token
    const user = await prisma.user.findFirst({
      where: {
        reset_token: hashedToken,
        reset_token_expires: {
          gt: new Date()
        }
      }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    // Hash new password
    const bcrypt = require('bcryptjs');
    const hashedPassword = await bcrypt.hash(password, 12);

    // Update user password and clear reset token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        reset_token: null,
        reset_token_expires: null
      }
    });

    return res.json({
      success: true,
      message: 'Password reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('[Reset Password] Error:', error.message);
    captureError(error, { endpoint: 'POST /api/auth/reset-password', action: 'reset_password' });
    
    return res.status(500).json({
      success: false,
      message: 'Failed to reset password. Please try again.'
    });
  }
});

module.exports = router;
