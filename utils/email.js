const { Resend } = require('resend');
const { buildVerifyEmailTemplate, buildResetPasswordTemplate } = require('./email-templates-legacy');

const resend = new Resend(process.env.RESEND_API_KEY);

/**
 * Sends a cinematic welcome email to new users.
 * @param {string} to - Recipient email
 * @param {string} name - Recipient name
 */
async function sendWelcomeEmail(to, name) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[Email] Skipping welcome email: RESEND_API_KEY not configured.');
    return;
  }

  try {
    const { data, error } = await resend.emails.send({
      from: 'TAKE ONE NEXUS <onboarding@takeone-nexus.net.in>',
      to: [to],
      subject: 'SIGNAL ESTABLISHED: Welcome to the Nexus, ' + name,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&display=swap');
            body { 
              background-color: #06080a; 
              color: #e0e0e0 !important; 
              font-family: 'Space Mono', monospace; 
              margin: 0; 
              padding: 0; 
            }
            .container { 
              max-width: 600px; 
              margin: 0 auto; 
              padding: 40px 20px; 
              border: 1px solid #cc441b;
              background: linear-gradient(180deg, #0e1218 0%, #06080a 100%);
              color: #e0e0e0;
            }
            .header { 
              text-align: center; 
              padding-bottom: 30px; 
              border-bottom: 1px solid rgba(204, 68, 27, 0.2);
            }
            .logo { 
              font-size: 32px; 
              font-weight: 700; 
              letter-spacing: 0.2em; 
              color: #ffffff !important;
            }
            .logo span { color: #cc441b !important; }
            .content { padding: 30px 0; line-height: 1.6; color: #e0e0e0 !important; }
            .greeting { font-size: 18px; color: #cc441b !important; margin-bottom: 20px; }
            .message { margin-bottom: 30px; color: #e0e0e0 !important; }
            .cta-wrap { text-align: center; margin: 40px 0; }
            .cta { 
              background-color: #cc441b; 
              color: #ffffff !important; 
              padding: 15px 30px; 
              text-decoration: none; 
              font-weight: 700; 
              text-transform: uppercase; 
              letter-spacing: 0.1em;
              display: inline-block;
              border-radius: 4px;
            }
            .footer { 
              font-size: 10px; 
              color: #888888 !important; 
              text-align: center; 
              padding-top: 30px; 
              border-top: 1px solid rgba(204, 68, 27, 0.1);
            }
            .glitch-text { text-transform: uppercase; letter-spacing: 0.3em; font-size: 12px; opacity: 0.7; color: #aaaaaa !important; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <div class="logo">TAKE <span>ONE</span></div>
              <div class="glitch-text">Film Crew Connect // Nexus established</div>
            </div>
            <div class="content">
              <div class="greeting">OPERATIVE IDENTIFIED: ${name}</div>
              <div class="message">
                Your signal has been successfully patched into the <strong>TAKE ONE NEXUS</strong>. 
                You are now part of an elite network of college filmmakers, writers, and technicians.
                <br><br>
                The production is rolling. Your role is ready.
              </div>
              <div class="cta-wrap">
                <a href="https://takeone-nexus.net.in/chat" class="cta">Enter The Nexus</a>
              </div>
              <div class="message">
                <strong>Next Steps:</strong><br>
                1. Complete your profile briefing.<br>
                2. Browse active scripts and crew calls.<br>
                3. Establish secure transmissions with collaborators.
              </div>
            </div>
            <div class="footer" style="padding-top: 24px; border-top: 1px solid rgba(204, 68, 27, 0.1);">
              <table cellpadding="0" cellspacing="0" border="0" style="margin: 0 auto 20px; width: auto;">
                <tr>
                  <td style="padding: 0 8px;">
                    <a href="https://www.linkedin.com/company/take-one-nexus" target="_blank" rel="noopener"
                       style="display:inline-block;background:#06080a;border:1px solid rgba(0,212,255,0.2);padding:10px 18px;text-decoration:none;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:0.15em;color:#00D4FF;text-transform:uppercase;">&#9656;&nbsp;LinkedIn</a>
                  </td>
                  <td style="padding: 0 8px;">
                    <a href="https://www.instagram.com/__take__one" target="_blank" rel="noopener"
                       style="display:inline-block;background:#06080a;border:1px solid rgba(204,68,27,0.2);padding:10px 18px;text-decoration:none;font-family:'Space Mono',monospace;font-size:9px;letter-spacing:0.15em;color:#cc441b;text-transform:uppercase;">&#9656;&nbsp;Instagram</a>
                  </td>
                </tr>
              </table>
              <div style="font-size: 9px; letter-spacing: 0.2em; color: #555555; text-transform: uppercase;">JOIN THE COMMUNITY</div><br/>
              SYSTEM TIME: ${new Date().toUTCString()}<br>
              © 2026 TAKE ONE NEXUS. ALL RIGHTS RESERVED.
            </div>
          </div>
        </body>
        </html>
      `
    });

    if (error) {
      console.error('[Email] Resend error:', error);
      return;
    }
  } catch (err) {
    console.error('[Email] Unexpected error sending welcome email:', err.message);
  }
}

/**
 * Sends a cinematic verification email.
 */
async function sendVerificationEmail(to, name, token) {
  if (!process.env.RESEND_API_KEY) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const verificationUrl = `${appUrl}/api/auth/verify-email?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'TAKE ONE NEXUS <auth@takeone-nexus.net.in>',
      to: [to],
      subject: 'ACTION REQUIRED: Verify Your Nexus Signal',
      html: buildVerifyEmailTemplate({ userName: name, verificationUrl })
    });
    if (error) console.error('[Email] Verification send error:', error);
  } catch (err) {
    console.error('[Email] Verification unexpected error:', err.message);
  }
}

/**
 * Sends a cinematic password reset email.
 */
async function sendPasswordResetEmail(to, name, token) {
  if (!process.env.RESEND_API_KEY) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: 'TAKE ONE NEXUS <security@takeone-nexus.net.in>',
      to: [to],
      subject: 'SECURITY PROTOCOL: Password Reset Requested',
      html: buildResetPasswordTemplate({ userName: name, resetUrl })
    });
    if (error) console.error('[Email] Reset send error:', error);
  } catch (err) {
    console.error('[Email] Reset unexpected error:', err.message);
  }
}

module.exports = {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail
};

