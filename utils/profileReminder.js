const prisma = require('./prisma');
const { Resend } = require('resend');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Calculates profile completion percentage and gets missing sections.
 * Checked fields: avatar_url, bio, skills, portfolio, social_links.
 */
function getProfileCompletionDetails(user) {
  const missing = [];
  let completed = 0;
  const total = 5;

  if (user.avatar_url && user.avatar_url.trim()) {
    completed++;
  } else {
    missing.push('Profile Photo');
  }

  if (user.bio && user.bio.trim()) {
    completed++;
  } else {
    missing.push('Bio / About Me');
  }

  if (user.skills && user.skills.trim()) {
    completed++;
  } else {
    missing.push('Skills');
  }

  if (user.portfolio && user.portfolio.trim()) {
    completed++;
  } else {
    missing.push('Portfolio Link / Reel');
  }

  if (user.social_links && user.social_links.trim()) {
    try {
      const parsed = JSON.parse(user.social_links);
      const hasLinks = Object.values(parsed).some(link => link && String(link).trim());
      if (hasLinks) {
        completed++;
      } else {
        missing.push('Social Links');
      }
    } catch (e) {
      if (user.social_links.trim()) {
        completed++;
      } else {
        missing.push('Social Links');
      }
    }
  } else {
    missing.push('Social Links');
  }

  const percent = Math.round((completed / total) * 100);
  return { percent, missing };
}

/**
 * Main function to verify profile completeness and send emails.
 * Runs in background or cron job.
 */
async function checkAndSendProfileReminders() {
  console.log('[Profile Reminder] Starting automated check...');
  if (!resend) {
    console.warn('[Profile Reminder] Resend API key is not configured. Email reminders will be skipped.');
    return;
  }

  try {
    // Get all users
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        avatar_url: true,
        bio: true,
        skills: true,
        portfolio: true,
        social_links: true
      }
    });

    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

    for (const user of users) {
      const { percent, missing } = getProfileCompletionDetails(user);

      if (percent < 100) {
        // Check if reminder was sent within last 10 days
        const recentReminder = await prisma.profileReminderLog.findFirst({
          where: {
            user_id: user.id,
            sent_at: {
              gte: tenDaysAgo
            }
          }
        });

        if (recentReminder) {
          console.log(`[Profile Reminder] User ${user.id} already received reminder within 10 days. Skipping.`);
          continue;
        }

        // Send Email via Resend
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://takeone-nexus.net.in';
        const profileUrl = `${appUrl}/profile`;

        console.log(`[Profile Reminder] Sending reminder to user ID: ${user.id} (${percent}% complete)`);

        const missingListHtml = missing.map(item => `<li style="margin-bottom: 8px; color: #ff4d1a; font-weight: bold;">• ${item}</li>`).join('');

        try {
          await resend.emails.send({
            from: 'TAKE ONE NEXUS <onboarding@takeone-nexus.net.in>',
            to: user.email,
            subject: '🎬 Complete your TAKE ONE Profile to showcase your skills',
            html: `
              <div style="background-color: #0b0c10; color: #ffffff; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; padding: 40px; border-radius: 12px; max-width: 600px; margin: 0 auto; border: 1px solid #1f2833;">
                <div style="text-align: center; margin-bottom: 30px;">
                  <h1 style="color: #ff4d1a; font-size: 28px; font-weight: bold; letter-spacing: 2px; margin: 0;">TAKE ONE</h1>
                  <p style="color: #66fcf1; font-size: 12px; text-transform: uppercase; letter-spacing: 3px; margin: 5px 0 0 0;">NEXUS PORTAL</p>
                </div>
                
                <h2 style="font-size: 20px; border-bottom: 2px solid #ff4d1a; padding-bottom: 10px; margin-bottom: 20px; color: #ffffff;">Hello, ${user.name}!</h2>
                
                <p style="font-size: 15px; line-height: 1.6; color: #c5c6c7;">
                  We noticed your creative profile is currently <strong>${percent}% complete</strong>. A complete profile makes it easier for other creators, directors, and crew members to discover your work and invite you to productions!
                </p>
                
                <div style="background-color: #1f2833; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #ff4d1a;">
                  <h3 style="margin-top: 0; font-size: 14px; text-transform: uppercase; color: #66fcf1; letter-spacing: 1px;">Missing Sections:</h3>
                  <ul style="list-style: none; padding-left: 0; margin: 0;">
                    ${missingListHtml}
                  </ul>
                </div>
                
                <div style="text-align: center; margin: 35px 0;">
                  <a href="${profileUrl}" style="background-color: #ff4d1a; color: #ffffff; padding: 14px 30px; font-size: 16px; font-weight: bold; text-decoration: none; border-radius: 6px; display: inline-block; box-shadow: 0 4px 15px rgba(255, 77, 26, 0.4); text-transform: uppercase; letter-spacing: 1px;">
                    Complete Your Profile
                  </a>
                </div>
                
                <p style="font-size: 13px; color: #888888; line-height: 1.5; text-align: center; margin-top: 40px; border-top: 1px solid #1f2833; paddingTop: 20px;">
                  Nexus Automated System • You are receiving this because your profile is not 100% complete.
                </p>
              </div>
            `
          });

          // Log reminder history
          await prisma.profileReminderLog.create({
            data: {
              user_id: user.id
            }
          });

          console.log(`[Profile Reminder] Successfully sent and logged reminder for user ID: ${user.id}`);
        } catch (emailError) {
          console.error(`[Profile Reminder] Email send failed for user ID ${user.id}:`, emailError.message);
        }
      }
    }
  } catch (error) {
    console.error('[Profile Reminder] Fatal check execution error:', error.message);
  }
}

module.exports = {
  checkAndSendProfileReminders,
  getProfileCompletionDetails
};
