/**
 * SHARED AUTHENTICATION MODAL LOGIC
 * Handles Login, Register, Forgot Password form submissions, validation, and layout updates.
 */

function bindSafeClick(element, handler, contextLabel) {
  if (!element) return;
  element.addEventListener('click', (event) => {
    try {
      handler(event);
    } catch (error) {
      console.error(`${contextLabel || 'Click handler'} failed:`, error);
    }
  });
}

function openTakeOneModal(modal) {
  try {
    if (!modal) return;
    if (typeof openModal === 'function') {
      openModal(modal);
      return;
    }

    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
  } catch (error) {
    console.error('openTakeOneModal failed:', error);
  }
}

function closeTakeOneModal(modal) {
  try {
    if (!modal) return;
    if (typeof closeModal === 'function') {
      closeModal(modal);
      return;
    }

    modal.classList.remove('show');
    if (!document.querySelector('.modal.show')) {
      document.body.style.overflow = '';
    }
  } catch (error) {
    console.error('closeTakeOneModal failed:', error);
  }
}

function showFieldError(id, message) {
  const el = document.getElementById(id);
  if (!el) return;
  
  el.classList.add('input-invalid');
  
  // Check if message already exists
  let msgEl = el.parentNode.querySelector('.validation-message');
  if (!msgEl) {
    msgEl = document.createElement('span');
    msgEl.className = 'validation-message';
    el.parentNode.appendChild(msgEl);
  }
  msgEl.textContent = message;
  
  // Auto-clear on change
  if (!el.dataset.hasValidationListener) {
    el.addEventListener('change', () => clearFieldError(id));
    el.dataset.hasValidationListener = 'true';
  }
}

function clearFieldError(id) {
  const el = document.getElementById(id);
  if (!el) return;
  
  el.classList.remove('input-invalid');
  const msgEl = el.parentNode.querySelector('.validation-message');
  if (msgEl) msgEl.remove();
}

function updateUIAfterLogin(user) {
  if (typeof Navbar !== 'undefined') {
    Navbar.render(user);
  } else {
    // Fallback if Navbar.js is not loaded
    const navCta = document.querySelector('.nav-cta');
    if (navCta) {
      navCta.textContent = 'Logout';
      navCta.onclick = (e) => {
        e.preventDefault();
        API.auth.logout();
      };
    }
    const navCrewLink = document.getElementById('navCrewLink');
    if (navCrewLink) {
      navCrewLink.href = '/crew';
      navCrewLink.textContent = 'Crew';
    }
  }

  if (typeof applyRoleBasedUI === 'function') {
    applyRoleBasedUI(user);
  }
  if (typeof renderDynamicUploadForm === 'function') {
    renderDynamicUploadForm(user);
  }
  if (typeof window.onAuthSuccess === 'function') {
    window.onAuthSuccess(user);
  }
}

function openAuthFromUrl() {
  const authMode = new URLSearchParams(window.location.search).get('auth');
  const loginModal = document.getElementById('loginModal');
  const registerModal = document.getElementById('registerModal');
  if (authMode === 'login') openTakeOneModal(loginModal);
  if (authMode === 'register') openTakeOneModal(registerModal);
}

// Bind auth components on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  const loginModal = document.getElementById('loginModal');
  const registerModal = document.getElementById('registerModal');
  const peopleModal = document.getElementById('peopleModal');
  const loginBtn = document.getElementById('loginBtn');
  const registerLink = document.getElementById('registerLink');
  const backToLoginLink = document.getElementById('backToLoginLink');
  const closeLoginBtn = document.getElementById('closeLoginBtn');
  const closeRegisterBtn = document.getElementById('closeRegisterBtn');
  const closePeopleModalBtn = document.getElementById('closePeopleModalBtn');
  const scriptModal = document.getElementById('scriptModal');
  const closeScriptModalBtn = document.getElementById('closeScriptModalBtn');

  bindSafeClick(loginBtn, () => {
    if (typeof API === 'undefined' || !API.auth) {
      console.error('API auth module unavailable during login button click');
      return;
    }
    if (API.auth.isLoggedIn()) {
      API.auth.logout();
    } else {
      openTakeOneModal(loginModal);
    }
  }, 'Login CTA');

  bindSafeClick(registerLink, (e) => {
    e.preventDefault();
    closeTakeOneModal(loginModal);
    openTakeOneModal(registerModal);
  }, 'Register tab open');

  bindSafeClick(backToLoginLink, (e) => {
    e.preventDefault();
    closeTakeOneModal(registerModal);
    openTakeOneModal(loginModal);
  }, 'Back to login tab');

  bindSafeClick(closeLoginBtn, () => closeTakeOneModal(loginModal), 'Close login modal');
  bindSafeClick(closeRegisterBtn, () => closeTakeOneModal(registerModal), 'Close register modal');
  bindSafeClick(closePeopleModalBtn, () => closeTakeOneModal(peopleModal), 'Close people modal');
  bindSafeClick(closeScriptModalBtn, () => closeTakeOneModal(scriptModal), 'Close script modal');

  // ── FORGOT PASSWORD MODAL WIRING ──
  const forgotPasswordModal = document.getElementById('forgotPasswordModal');
  const forgotPasswordLink = document.getElementById('forgotPasswordLink');
  const closeForgotPasswordBtn = document.getElementById('closeForgotPasswordBtn');
  const backToLoginFromForgot = document.getElementById('backToLoginFromForgot');
  const forgotPasswordForm = document.getElementById('forgotPasswordForm');

  bindSafeClick(forgotPasswordLink, (e) => {
    e.preventDefault();
    closeTakeOneModal(loginModal);
    openTakeOneModal(forgotPasswordModal);
  }, 'Forgot password modal open');

  bindSafeClick(closeForgotPasswordBtn, () => closeTakeOneModal(forgotPasswordModal), 'Close forgot password modal');

  bindSafeClick(backToLoginFromForgot, (e) => {
    e.preventDefault();
    closeTakeOneModal(forgotPasswordModal);
    openTakeOneModal(loginModal);
  }, 'Back to login from forgot');

  forgotPasswordForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const emailInput = document.getElementById('forgotEmail');
    const msgDiv = document.getElementById('forgotPasswordMsg');
    const submitBtn = document.getElementById('forgotPasswordSubmitBtn');

    if (!emailInput || !msgDiv || !submitBtn) return;

    const email = emailInput.value.trim();
    const originalText = submitBtn.textContent;

    msgDiv.style.display = 'none';
    msgDiv.className = '';
    msgDiv.textContent = '';

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Transmitting request...';

      const response = await API.users.forgotPassword(email);
      if (response.success) {
        msgDiv.style.display = 'block';
        msgDiv.style.background = 'rgba(0, 212, 255, 0.1)';
        msgDiv.style.border = '1px solid var(--cyan)';
        msgDiv.style.color = 'var(--cyan)';
        msgDiv.textContent = response.message || 'If registered, a secure reset link has been sent.';
        forgotPasswordForm.reset();
      }
    } catch (err) {
      msgDiv.style.display = 'block';
      msgDiv.style.background = 'rgba(255, 77, 26, 0.1)';
      msgDiv.style.border = '1px solid var(--neon)';
      msgDiv.style.color = 'var(--neon)';
      msgDiv.textContent = err.message || 'Transmission failed. Please try again later.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  window.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.classList.contains('modal')) {
      closeTakeOneModal(e.target);
    }
  });

  const loginForm = document.getElementById('loginForm');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const emailInput = document.getElementById('loginEmail');
    const passwordInput = document.getElementById('loginPassword');
    if (!emailInput || !passwordInput) {
      console.error('Login form inputs not found in DOM');
      showToast('❌ Login form is unavailable');
      return;
    }
    const email = emailInput.value;
    const password = passwordInput.value;
    
    const submitBtn = loginForm.querySelector('.form-submit');
    const originalText = submitBtn.textContent;
    
    // Clear previous errors
    const existingError = loginForm.querySelector('.form-error');
    if (existingError) existingError.remove();

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Authenticating Signal...';
      
      const response = await API.users.login(email, password);
      
      if (response.success) {
        API.auth.saveToken(response.token, response.user);
        showToast(`Welcome back, ${response.user.name}! ✦`);
        closeTakeOneModal(loginModal);
        loginForm.reset();
        updateUIAfterLogin(response.user);
        
        // Trigger email verification reminder popup after login
        if (window.triggerEmailVerificationReminder) {
          setTimeout(() => window.triggerEmailVerificationReminder('login'), 1500);
        }
      }
    } catch (err) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'form-error';
      errorDiv.textContent = err.message || 'Login failed. Check your email and password.';
      loginForm.prepend(errorDiv);
      
      showToast(`❌ Login Failed`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  const registerForm = document.getElementById('registerForm');
  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const nameInput = document.getElementById('registerName');
    const emailInput = document.getElementById('registerEmail');
    const passwordInput = document.getElementById('registerPassword');
    const confirmPasswordInput = document.getElementById('registerConfirmPassword');
    const roleInput = document.getElementById('registerRole');
    const collegeInput = document.getElementById('registerCollege');
    const cityInput = document.getElementById('registerCity');
    const genderInput = document.getElementById('registerGender');

    if (!nameInput || !emailInput || !passwordInput || !confirmPasswordInput || !roleInput || !collegeInput || !cityInput || !genderInput) {
      console.error('Register form inputs not found in DOM');
      showToast('❌ Registration form is unavailable');
      return;
    }

    const name = nameInput.value;
    const email = emailInput.value;
    const password = passwordInput.value;
    const confirmPassword = confirmPasswordInput.value;
    const role = roleInput.value;
    const college = collegeInput.value;
    const city = cityInput.value;
    const gender = genderInput.value;
    
    if (password !== confirmPassword) {
      showToast('❌ Passwords do not match');
      return;
    }
    
    if (password.length < 8) {
      showToast('❌ Password must be at least 8 characters');
      return;
    }
    const submitBtn = registerForm.querySelector('.wizard-btn-next[type="submit"]') ||
                      registerForm.querySelector('[type="submit"]');
    if (!submitBtn) {
      console.error('[Register] Submit button not found in registerForm');
      showToast('❌ Form error — please refresh the page');
      return;
    }
    const originalText = submitBtn.textContent;
    
    // Clear previous errors
    const existingError = registerForm.querySelector('.form-error');
    if (existingError) existingError.remove();

    // Custom validation for dropdowns
    let hasError = false;
    
    const validateDropdown = (id, message) => {
      const el = document.getElementById(id);
      if (!el || !el.value) {
        showFieldError(id, message);
        hasError = true;
      } else {
        clearFieldError(id);
      }
    };

    validateDropdown('registerRole', 'Please select your role');
    validateDropdown('registerDisplayPreference', 'Please select display preference');
    validateDropdown('registerGender', 'Please select your gender');

    if (hasError) {
      showToast('❌ Missing required selections');
      return;
    }

    if (password !== confirmPassword) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'form-error';
      errorDiv.textContent = 'Passwords do not match ✦';
      registerForm.prepend(errorDiv);
      return;
    }

    try {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Generating Crew Card...';

      const screen_name = document.getElementById('registerScreenName')?.value || '';
      const display_preference = document.getElementById('registerDisplayPreference')?.value || 'Show Real Name Only';

      const payload = { name, email, password, role, gender, college, city, screen_name, display_preference};
      console.log('[Register] Submitting registration payload:', { ...payload, password: '[REDACTED]' });

      const response = await API.users.register(payload);
      console.log('[Register] API response:', response);
      
      if (response.success) {
        API.auth.saveToken(response.token, response.user);
        showToast(`Welcome to the set, ${response.user.name}! ✦`);
        closeTakeOneModal(registerModal);
        registerForm.reset();
        updateUIAfterLogin(response.user);
        
        // Trigger email verification reminder popup after registration
        if (window.triggerEmailVerificationReminder) {
          setTimeout(() => window.triggerEmailVerificationReminder('register'), 1500);
        }
      }
    } catch (err) {
      const errorDiv = document.createElement('div');
      errorDiv.className = 'form-error';
      errorDiv.textContent = err.message || 'Registration failed. Please try again.';
      registerForm.prepend(errorDiv);
      
      showToast(`❌ Registration Failed`);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });

  openAuthFromUrl();
});
