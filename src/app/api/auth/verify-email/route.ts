import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import * as jose from 'jose';
import prisma from '@/lib/prisma';
import { awardCreditTask } from '@/lib/credits';
import {
  generateSecureToken,
  hashToken,
  getVerificationExpiry,
  isExpired,
} from '@/lib/email-tokens';
import { buildVerifyEmailTemplate } from '@/lib/email-templates/verify-email';
import { checkRateLimit, getClientIP, buildRateLimitKey } from '@/lib/rate-limiter';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { captureError } from '@/lib/sentry';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'takeone_fallback_secret_32_chars_long'
);

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  const isVercelPreview = Boolean(process.env.VERCEL_URL?.includes('vercel.app'));
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
    path: '/',
    maxAge: 10 * 24 * 60 * 60,
    domain: isProd && !isVercelPreview ? '.takeone-nexus.net.in' : undefined,
  };
}

/**
 * GET /api/auth/verify-email?token=xxx
 * Validates the verification token and marks the user as verified.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIP(request);
  const rl = checkRateLimit(buildRateLimitKey('verify-email', ip), RATE_LIMITS.verifyEmail);

  if (!rl.success) {
    return NextResponse.json(
      { success: false, message: 'Too many verification attempts. Please wait before trying again.', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    );
  }

  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');

  if (!token || token.length !== 64) {
    return NextResponse.redirect(new URL('/verify-email?status=invalid', request.url));
  }

  try {
    const hashedToken = hashToken(token);

    const user = await prisma.user.findFirst({
      where: { verification_token: hashedToken },
      select: {
        id: true,
        email: true,
        role: true,
        secondary_role: true,
        email_verified: true,
        verification_token_expires: true,
      },
    });

    if (!user) {
      return NextResponse.redirect(new URL('/verify-email?status=invalid', request.url));
    }

    if (user.email_verified) {
      return NextResponse.redirect(new URL('/verify-email?status=already-verified', request.url));
    }

    if (isExpired(user.verification_token_expires)) {
      return NextResponse.redirect(new URL('/verify-email?status=expired', request.url));
    }

    // Mark as verified, clear the token
    await prisma.user.update({
      where: { id: user.id },
      data: {
        email_verified: true,
        email_verified_at: new Date(),
        verification_token: null,
        verification_token_expires: null,
      },
    });

    // Award verification credits
    try {
      await awardCreditTask(user.id, 'EMAIL_VERIFICATION');
    } catch (err) {
      console.error('Failed to award verification credits:', err);
    }

    const sessionToken = await new jose.SignJWT({
      id: user.id,
      email: user.email,
      role: user.role || '',
      secondary_role: user.secondary_role || null,
      email_verified: true,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10d')
      .sign(JWT_SECRET);

    const response = NextResponse.redirect(new URL('/verify-email?status=success', request.url));
    response.cookies.set('token', sessionToken, getCookieOptions());
    return response;
  } catch (error) {
    captureError(error, { endpoint: 'GET /api/auth/verify-email', action: 'token_validation' });
    return NextResponse.redirect(new URL('/verify-email?status=error', request.url));
  }
}

/**
 * POST /api/auth/verify-email
 * Resends a verification email to the authenticated user.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const email = (body?.email || '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 });
    }

    // Rate limit by email — 3 resends per hour
    const rl = checkRateLimit(buildRateLimitKey('resend-verify', 'email', email), RATE_LIMITS.resendVerification);
    if (!rl.success) {
      return NextResponse.json(
        { success: false, message: 'Too many resend requests. Please wait before requesting another verification email.', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      );
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, email_verified: true },
    });

    // Always return success to prevent email enumeration
    if (!user || user.email_verified) {
      return NextResponse.json({ success: true, message: 'If this email is registered and unverified, a new verification link has been sent.' });
    }

    const token = generateSecureToken();
    const hashedToken = hashToken(token);
    const expiry = getVerificationExpiry();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        verification_token: hashedToken,
        verification_token_expires: expiry,
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://takeone-nexus.net.in';
    const verificationUrl = `${baseUrl}/api/auth/verify-email?token=${token}`;
    const resend = getResendClient();

    if (!resend) {
      return NextResponse.json(
        { success: false, message: 'Email service is not configured. Please try again later.' },
        { status: 503 }
      );
    }

    await resend.emails.send({
      from: 'TAKE ONE Nexus <noreply@takeone-nexus.net.in>',
      to: user.email,
      subject: '⚡ Verify your TAKE ONE account',
      html: buildVerifyEmailTemplate({
        userName: user.name,
        verificationUrl,
        expiresInHours: 24,
      }),
    });

    return NextResponse.json({ success: true, message: 'Verification email sent.' });
  } catch (error) {
    captureError(error, { endpoint: 'POST /api/auth/verify-email', action: 'resend_verification' });
    return NextResponse.json({ success: false, message: 'Failed to send verification email. Please try again.' }, { status: 500 });
  }
}
