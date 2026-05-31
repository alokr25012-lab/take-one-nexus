import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import prisma from '@/lib/prisma';
import {
  generateSecureToken,
  hashToken,
  getResetExpiry,
} from '@/lib/email-tokens';
import { buildResetPasswordTemplate } from '@/lib/email-templates/reset-password';
import { checkRateLimit, getClientIP, buildRateLimitKey } from '@/lib/rate-limiter';
import { RATE_LIMITS } from '@/lib/rate-limit-config';
import { captureError } from '@/lib/sentry';

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  return new Resend(apiKey);
}

/**
 * POST /api/auth/forgot-password
 * Generates a password reset token and sends reset email.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIP(request);

  try {
    const body = await request.json();
    const email = (body?.email || '').trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 });
    }

    // Rate limit by IP
    const rlIp = checkRateLimit(buildRateLimitKey('forgot-password', ip), RATE_LIMITS.forgotPassword);
    if (!rlIp.success) {
      return NextResponse.json(
        { success: false, message: 'Too many reset requests from this connection. Please wait before trying again.', retryAfter: rlIp.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rlIp.retryAfter) } }
      );
    }

    // Rate limit by email — prevents targeting a specific user
    const rlEmail = checkRateLimit(buildRateLimitKey('forgot-password', 'email', email), RATE_LIMITS.forgotPassword);
    if (!rlEmail.success) {
      // Return success to prevent email enumeration (attacker shouldn't know email exists)
      return NextResponse.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true },
    });

    // Always return success — prevents email enumeration attacks
    if (!user) {
      return NextResponse.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
    }

    const token = generateSecureToken();
    const hashedToken = hashToken(token);
    const expiry = getResetExpiry();

    await prisma.user.update({
      where: { id: user.id },
      data: {
        reset_token: hashedToken,
        reset_token_expires: expiry,
      },
    });

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://takeone-nexus.net.in';
    const resetUrl = `${baseUrl}/reset-password?token=${token}`;

    console.log('[NEXTJS AUTH] Sending reset email to:', user.email);
    console.log('[NEXTJS AUTH] Reset URL:', resetUrl);

    if (!process.env.RESEND_API_KEY) {
      console.error('[NEXTJS AUTH] Cannot send email: RESEND_API_KEY not configured');
    } else {
      try {
        const resend = getResendClient();
        if (!resend) {
          console.error('[NEXTJS AUTH] Cannot send email: RESEND_API_KEY not configured');
          return NextResponse.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
        }

        const result = await resend.emails.send({
          from: 'TAKE ONE NEXUS <onboarding@takeone-nexus.net.in>',
          to: user.email,
          subject: '🔐 Reset your TAKE ONE password',
          html: buildResetPasswordTemplate({
            userName: user.name,
            resetUrl,
            expiresInMinutes: 60,
          }),
        });
        console.log('[NEXTJS AUTH] Email sent successfully:', result);
      } catch (emailError) {
        console.error('[NEXTJS AUTH] Email send failed:', emailError);
        console.error('[NEXTJS AUTH] Error details:', JSON.stringify(emailError, null, 2));
        captureError(emailError, { endpoint: 'POST /api/auth/forgot-password', action: 'send_reset_email' });
      }
    }

    return NextResponse.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
  } catch (error) {
    captureError(error, { endpoint: 'POST /api/auth/forgot-password', action: 'send_reset_email' });
    // Don't leak error details — always return success message
    return NextResponse.json({ success: true, message: 'If this email is registered, a reset link has been sent.' });
  }
}
