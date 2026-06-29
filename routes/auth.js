const express = require('express');
const crypto = require('crypto');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/db');
const prisma = require('../utils/prisma');
const { Resend } = require('resend');
const { createRateLimiter, authLimiter } = require('../middleware/rateLimiter');
const { captureError } = require('../src/lib/sentry');

const router = express.Router();

// ── GOOGLE OAUTH ──

const CALLBACK_URL = process.env.NODE_ENV === 'production'
  ? 'https://takeone-nexus.net.in/api/auth/google/callback'
  : 'http://localhost:5001/api/auth/google/callback';

function createToken(user) {
  const secret = process.env.JWT_SECRET || 'takeone_fallback_secret_32_chars_long';
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role || '',
      secondary_role: user.secondary_role || null,
      email_verified: true
    },
    secret,
    { expiresIn: '10d' }
  );
}

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? 'None' : 'Lax',
    path: '/',
    maxAge: 10 * 24 * 60 * 60 * 1000,
    domain: isProd ? '.takeone-nexus.net.in' : undefined
  };
}

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: CALLBACK_URL,
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const name = profile.displayName;
    const googleId = profile.id;

    const [existing] = await pool.query(
      'SELECT * FROM users WHERE email = ? LIMIT 1',
      [email]
    );

    if (existing.length > 0) {
      if (!existing[0].google_id) {
        await pool.query(
          'UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?',
          [googleId, existing[0].id]
        );
      }
      return done(null, existing[0]);
    }

    const [result] = await pool.query(
      `INSERT INTO users (name, email, google_id, email_verified, role, display_preference, gender)
       VALUES (?, ?, ?, 1, '', 'Show Real Name Only', 'Prefer not to say')`,
      [name, email, googleId]
    );

    const [newUser] = await pool.query(
      'SELECT * FROM users WHERE id = ? LIMIT 1',
      [result.insertId]
    );

    return done(null, newUser[0]);
  } catch (err) {
    return done(err, null);
  }
}));

router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email'],
  session: false
}));

router.get('/google/callback',
  passport.authenticate('google', { session: false, failureRedirect: '/?auth=failed' }),
  (req, res) => {
    res.cookie('token', createToken(req.user), getCookieOptions());
    res.redirect('/?auth=success');
  }
);

// ── FORGOT PASSWORD ──

if (!process.env.RESEND_API_KEY) {
  console.warn('[AUTH] WARNING: RESEND_API_KEY not configured. Password reset emails will not be sent.');
}
const resend = new Resend(process.env.RESEND_API_KEY);

const forgotPasswordLimiter = createRateLimiter({
  limit: 3,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'forgot-password'
});

// Rate limiter for reset password.
const resetPasswordLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000,
  keyPrefix: 'reset-password'
});

function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function getResetExpiry() {
  return new Date(Date.now() + 60 * 60 * 1000);
}

function buildResetPasswordTemplate({ userName, resetUrl, expiresInMinutes }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Reset Your Password</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #0a0c10; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background-color: #14161a; border-radius: 8px; overflow: hidden; border: 1px solid #ff4d1a; }
        .header { background: linear-gradient(135deg, #ff4d1a 0%, #ff6a42 100%); padding: 30px; text-align: center; }
        .header h1 { margin: 0; color: #06080a; font-size: 24px; text-transform: uppercase; letter-spacing: 2px; }
        .content { padding: 30px; }
        .content p { line-height: 1.6; margin-bottom: 20px; }
        .button { display: inline-block; background-color: #ff4d1a; color: #06080a; padding: 15px 30px; text-decoration: none; border-radius: 4px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin: 20px 0; }
        .footer { background-color: #0a0c10; padding: 20px; text-align: center; font-size: 12px; color: #888; }
        .warning { color: #ff6a42; font-size: 12px; margin-top: 20px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header"><h1>Take One Nexus</h1></div>
        <div class="content">
          <p>Hello ${userName},</p>
          <p>We received a request to reset your password for your Take One Nexus account.</p>
          <p>Click the button below to reset your password:</p>
          <center><a href="${resetUrl}" class="button">Reset Password</a></center>
          <p>This link will expire in ${expiresInMinutes} minutes.</p>
          <p class="warning">If you didn't request this password reset, please ignore this email.</p>
        </div>
        <div class="footer"><p>© 2026 Take One Nexus. All rights reserved.</p></div>
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
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true, email: true }
    });

    if (!user) {
      return res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
    }

    const token = generateSecureToken();
    const hashedToken = hashToken(token);
    const expiry = getResetExpiry();

    await prisma.user.update({
      where: { id: user.id },
      data: { reset_token: hashedToken, reset_token_expires: expiry }
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://takeone-nexus.net.in';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    try {
      if (process.env.RESEND_API_KEY) {
        await resend.emails.send({
          from: 'TAKE ONE NEXUS <onboarding@takeone-nexus.net.in>',
          to: user.email,
          subject: '🔐 Reset your TAKE ONE password',
          html: buildResetPasswordTemplate({ userName: user.name, resetUrl, expiresInMinutes: 60 })
        });
      }
    } catch (emailError) {
      captureError(emailError, { endpoint: 'POST /api/auth/forgot-password' });
    }

    return res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
  } catch (error) {
    captureError(error, { endpoint: 'POST /api/auth/forgot-password' });
    return res.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
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
      return res.status(400).json({ success: false, message: 'Token and password are required' });
    }

    if (password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
    }

    const hashedToken = hashToken(token);

    const user = await prisma.user.findFirst({
      where: { reset_token: hashedToken, reset_token_expires: { gt: new Date() } }
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword, reset_token: null, reset_token_expires: null }
    });

    return res.json({ success: true, message: 'Password reset successfully. You can now login with your new password.' });
  } catch (error) {
    captureError(error, { endpoint: 'POST /api/auth/reset-password' });
    return res.status(500).json({ success: false, message: 'Failed to reset password. Please try again.' });
  }
});

module.exports = router;