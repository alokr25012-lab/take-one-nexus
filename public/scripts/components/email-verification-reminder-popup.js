/**
 * Email Verification Reminder Popup for Legacy HTML Page
 * Shows popup for unverified users after login, registration, profile access, and periodically
 */

(function() {
  'use strict';

  // DOM Elements
  let popupOverlay = null;
  let popupContent = null;
  let verifyNowBtn = null;
  let resendBtn = null;
  let remindLaterBtn = null;
  let closeBtn = null;
  let cooldownDisplay = null;
  let errorDisplay = null;
  let successDisplay = null;

  // State
  let userEmail = '';
  let cooldown = 0;
  let cooldownInterval = null;
  let isVerified = true;

  // Initialize popup
  function initPopup() {
    // Create popup HTML if it doesn't exist
    if (!document.getElementById('emailVerificationReminderPopup')) {
      createPopupHTML();
    }

    // Get elements
    popupOverlay = document.getElementById('emailVerificationReminderPopup');
    popupContent = document.getElementById('emailVerificationPopupContent');
    verifyNowBtn = document.getElementById('evrVerifyNow');
    resendBtn = document.getElementById('evrResend');
    remindLaterBtn = document.getElementById('evrRemindLater');
    closeBtn = document.getElementById('evrClose');
    cooldownDisplay = document.getElementById('evrCooldown');
    errorDisplay = document.getElementById('evrError');
    successDisplay = document.getElementById('evrSuccess');

    // Attach event listeners
    if (verifyNowBtn) verifyNowBtn.addEventListener('click', handleVerifyNow);
    if (resendBtn) resendBtn.addEventListener('click', handleResend);
    if (remindLaterBtn) remindLaterBtn.addEventListener('click', handleRemindLater);
    if (closeBtn) closeBtn.addEventListener('click', () => hidePopup());

    // Check verification status (delayed slightly to prevent race conditions with page load / project.js initialization)
    setTimeout(checkVerificationStatus, 2500);

    // Listen for trigger events
    window.addEventListener('email-verification-reminder', handleTriggerEvent);
  }

  function createPopupHTML() {
    const popupHTML = `
      <div id="emailVerificationReminderPopup" style="display: none; position: fixed; inset: 0; background: rgba(6, 8, 10, 0.92); backdrop-filter: blur(8px); z-index: 10000; align-items: center; justify-content: center; padding: 16px;" role="dialog" aria-modal="true" aria-labelledby="evrTitle">
        <div id="emailVerificationPopupContent" style="background: #0E1218; border: 1px solid rgba(255, 77, 26, 0.3); border-radius: 12px; padding: 40px; width: 100%; max-width: 480px; position: relative; box-shadow: 0 0 60px rgba(255, 77, 26, 0.12);">
          <!-- Filmstrip top accent -->
          <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, #ff4d1a, #ff7a1a); border-radius: 12px 12px 0 0;" aria-hidden="true"></div>

          <!-- Close button -->
          <button id="evrClose" style="position: absolute; top: 16px; right: 16px; background: none; border: none; color: #6B7A8D; cursor: pointer; font-size: 18px; line-height: 1; padding: 4px; opacity: 0.6; transition: opacity 0.2s;" aria-label="Close popup">✕</button>

          <!-- Icon -->
          <div style="width: 64px; height: 64px; border-radius: 50%; background: rgba(255, 77, 26, 0.1); display: flex; align-items: center; justify-content: center; border: 2px solid rgba(255, 77, 26, 0.3); margin: 0 auto 24px;" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#ff4d1a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>

          <!-- Title -->
          <h2 id="evrTitle" style="font-family: 'Bebas Neue', sans-serif; font-size: 28px; letter-spacing: 4px; color: #ff4d1a; margin-bottom: 12px; text-align: center; text-transform: uppercase;">Verify Your Email Address</h2>

          <!-- Message -->
          <p style="font-size: 13px; color: #6B7A8D; margin-bottom: 24px; text-align: center; line-height: 1.6; letter-spacing: 0.02em;">
            Your email address has not been verified yet.<br />
            Verify your account to unlock all platform features and improve account security.
          </p>

          <!-- Error message -->
          <div id="evrError" style="display: none; background: rgba(255, 51, 102, 0.1); border: 1px solid rgba(255, 51, 102, 0.3); border-radius: 6px; padding: 12px 16px; font-size: 12px; color: #ff3366; margin-bottom: 20px; text-align: center; letter-spacing: 0.05em;" role="alert" aria-live="polite"></div>

          <!-- Success message -->
          <div id="evrSuccess" style="display: none; background: rgba(0, 255, 136, 0.08); border: 1px solid rgba(0, 255, 136, 0.25); border-radius: 6px; padding: 12px 16px; font-size: 12px; color: #00ff88; margin-bottom: 20px; text-align: center; letter-spacing: 0.05em;" role="status" aria-live="polite"></div>

          <!-- Action Buttons -->
          <div style="display: flex; flex-direction: column; gap: 12px;">
            <button id="evrVerifyNow" style="width: 100%; background: #ff4d1a; color: #06080A; border: none; border-radius: 6px; padding: 14px; font-size: 12px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; cursor: pointer; font-family: 'Bebas Neue', sans-serif; box-shadow: 0 0 20px rgba(255, 77, 26, 0.3); transition: all 0.2s;">
              Verify Now
            </button>

            <button id="evrResend" style="width: 100%; background: transparent; color: #ff4d1a; border: 1px solid #ff4d1a; border-radius: 6px; padding: 14px; font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; cursor: pointer; font-family: 'Space Mono', monospace; transition: all 0.2s;">
              Resend Verification Email
            </button>

            <button id="evrRemindLater" style="width: 100%; background: none; color: #6B7A8D; border: none; border-radius: 6px; padding: 12px; font-size: 11px; font-weight: 400; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; font-family: 'Space Mono', monospace; opacity: 0.7; transition: opacity 0.2s;">
              Remind Me Later
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', popupHTML);
  }

  function shouldShowPopup() {
    const remindLaterKey = 'email-verification-remind-later';
    const remindLaterTime = localStorage.getItem(remindLaterKey);
    
    if (remindLaterTime) {
      const remindDate = new Date(remindLaterTime);
      const now = new Date();
      const hoursSinceReminder = (now.getTime() - remindDate.getTime()) / (1000 * 60 * 60);
      
      if (hoursSinceReminder < 24) {
        return false;
      }
    }
    
    return true;
  }

  async function checkVerificationStatus() {
    try {
      const res = await fetch('/api/users/me', { 
        credentials: 'include',
        cache: 'no-store'
      });
      if (!res.ok) return;
      const data = await res.json();
      
      if (data.success && data.user) {
        isVerified = data.user.email_verified ;
        userEmail = data.user.email || '';
        
        if (!isVerified && shouldShowPopup()) {
          setTimeout(() => showPopup(), 1500);
        }
      }
    } catch (error) {
      // Silent fail - don't show errors to user for background checks
      console.debug('Verification status check failed:', error);
    }
  }

  function showPopup() {
    if (popupOverlay) {
      popupOverlay.style.display = 'flex';
      // Ensure custom cursor elements are visible above modal
      const cursorDot = document.getElementById('dot') || document.querySelector('.cur-dot');
      const cursorCross = document.getElementById('cross') || document.querySelector('.cur-cross');
      if (cursorDot) cursorDot.style.zIndex = '10002';
      if (cursorCross) cursorCross.style.zIndex = '10002';
    }
  }

  function hidePopup() {
    if (popupOverlay) {
      popupOverlay.style.display = 'none';
      // Reset cursor z-index
      const cursorDot = document.getElementById('dot') || document.querySelector('.cur-dot');
      const cursorCross = document.getElementById('cross') || document.querySelector('.cur-cross');
      if (cursorDot) cursorDot.style.zIndex = '10001';
      if (cursorCross) cursorCross.style.zIndex = '10001';
    }
  }

  function handleVerifyNow() {
    hidePopup();
    // Redirect to profile page which has OTP verification
    // Use replace to prevent back button from showing popup again
    window.location.replace('/profile');
  }

  async function handleResend() {
    if (cooldown > 0 || !userEmail) return;

    if (resendBtn) {
      resendBtn.textContent = 'Sending...';
      resendBtn.disabled = true;
    }

    if (errorDisplay) errorDisplay.style.display = 'none';
    if (successDisplay) successDisplay.style.display = 'none';

    try {
      const csrfRes = await fetch('/api/csrf-token', { credentials: 'include' });
      const csrfData = await csrfRes.json();
      const csrfToken = csrfData.csrfToken || '';

      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify({ email: userEmail }),
      });
      const data = await res.json();

      if (res.status === 429) {
        if (errorDisplay) {
          errorDisplay.textContent = data.message || 'Too many requests. Please wait.';
          errorDisplay.style.display = 'block';
        }
        cooldown = data.retryAfter || 60;
        startCooldown();
      } else if (res.ok) {
        if (successDisplay) {
          successDisplay.textContent = `✓ Verification email sent successfully to ${userEmail}`;
          successDisplay.style.display = 'block';
        }
        cooldown = 60;
        startCooldown();
      } else {
        if (errorDisplay) {
          errorDisplay.textContent = data.message || 'Failed to send verification email.';
          errorDisplay.style.display = 'block';
        }
      }
    } catch (error) {
      if (errorDisplay) {
        errorDisplay.textContent = 'Failed to send. Please try again.';
        errorDisplay.style.display = 'block';
      }
    } finally {
      if (resendBtn) {
        resendBtn.disabled = false;
        if (cooldown > 0) {
          resendBtn.textContent = `Retry in ${cooldown}s`;
        } else {
          resendBtn.textContent = 'Resend Verification Email';
        }
      }
    }
  }

  function handleRemindLater() {
    const remindLaterKey = 'email-verification-remind-later';
    localStorage.setItem(remindLaterKey, new Date().toISOString());
    hidePopup();
  }

  function startCooldown() {
    if (cooldownInterval) clearInterval(cooldownInterval);
    
    cooldownInterval = setInterval(() => {
      cooldown--;
      if (resendBtn) {
        resendBtn.textContent = `Retry in ${cooldown}s`;
        resendBtn.disabled = true;
      }
      
      if (cooldown <= 0) {
        clearInterval(cooldownInterval);
        cooldownInterval = null;
        if (resendBtn) {
          resendBtn.textContent = 'Resend Verification Email';
          resendBtn.disabled = false;
        }
      }
    }, 1000);
  }

  function cleanup() {
    if (cooldownInterval) {
      clearInterval(cooldownInterval);
      cooldownInterval = null;
    }
    window.removeEventListener('email-verification-reminder', handleTriggerEvent);
  }

  function handleTriggerEvent(event) {
    const { trigger } = event.detail;
    if (trigger) {
      checkVerificationStatus();
    }
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPopup);
  } else {
    initPopup();
  }

  // Cleanup on page unload
  window.addEventListener('beforeunload', cleanup);

  // Check if on profile page and trigger popup
  function checkProfilePage() {
    if (window.location.pathname === '/profile' || window.location.pathname === '/profile/') {
      if (window.triggerEmailVerificationReminder) {
        setTimeout(() => window.triggerEmailVerificationReminder('profile'), 1000);
      }
    }
  }

  // Listen for route changes (for SPA navigation)
  window.addEventListener('popstate', checkProfilePage);
  
  // Initial profile page check
  checkProfilePage();

  // Export trigger function for external use
  window.triggerEmailVerificationReminder = function(triggerType) {
    window.dispatchEvent(new CustomEvent('email-verification-reminder', {
      detail: { trigger: triggerType }
    }));
  };

})();
