/**
 * REGISTRATION MULTI-STEP WIZARD CONTROLLER
 * Manages clean state transitions, pathway sorting, and validation.
 *
 * NOTE: This script is loaded with `defer`, which guarantees the DOM is fully
 * parsed before execution. Do NOT wrap code in DOMContentLoaded here — the
 * event will already have fired by the time defer scripts run, causing the
 * callback to never execute (silent no-op bug).
 */

(function() {
  // ── PASSWORD VISIBILITY TOGGLES ──
  // Runs for ALL .pw-toggle buttons on the page (login + register modals).
  // Safe to run immediately since defer guarantees DOM is ready.
  const EYE_OPEN = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
  const EYE_OFF  = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;

  const pwToggles = document.querySelectorAll('.pw-toggle');
  console.log(`[Auth] Attaching password toggles to ${pwToggles.length} button(s)`);
  pwToggles.forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.pw-wrap');
      if (!wrap) return;
      const input = wrap.querySelector('input');
      if (!input) return;
      const revealing = input.type === 'password';
      input.type = revealing ? 'text' : 'password';
      btn.innerHTML = revealing ? EYE_OFF : EYE_OPEN;
      btn.setAttribute('aria-label', revealing ? 'Hide password' : 'Show password');
    });
  });

  // ── WIZARD SETUP ──
  const registerModal = document.getElementById('registerModal');
  const registerForm = document.getElementById('registerForm');
  if (!registerForm) return;

  const steps = registerForm.querySelectorAll('.wizard-step');
  const progressSteps = registerForm.querySelectorAll('.progress-step');

  // Step 1 Buttons
  const btnNext1 = document.getElementById('registerNext1');

  // Step 2 Buttons
  const btnBack1 = document.getElementById('registerBack1');
  const btnNext2 = document.getElementById('registerNext2');

  // Step 3 Buttons
  const btnBack2 = document.getElementById('registerBack2');

  // Pathway Cards
  const cardCreator = document.getElementById('pathwayCreator');
  const cardCrew = document.getElementById('pathwayCrew');
  const selectRole = document.getElementById('registerRole');

  let currentStep = 1;

  const passwordInput = document.getElementById('registerPassword');
    if(passwordInput){
      passwordInput.addEventListener('input', updatePasswordStrength);
    }
    function updatePasswordStrength() {
      const passwordContainer = document.getElementById('passwordStrength');
      const password = passwordInput.value;

      if(!password.length){
        passwordContainer.style.display = 'none';
        return;
      }
      passwordContainer.style.display = 'block';
      const strengthFill = document.getElementById('strengthFill');
      const strengthText = document.getElementById('strengthText');
      const ruleLength = document.getElementById('ruleLength');
      const ruleUpper = document.getElementById('ruleUpper');
      const ruleNumber = document.getElementById('ruleNumber');
      const ruleSpecial = document.getElementById('ruleSpecial');

      const hasLength = password.length >= 8;
      const hasUpper = /[A-Z]/.test(password);
      const hasNumber = /[0-9]/.test(password);
      const hasSpecial = /[^A-Za-z0-9]/.test(password);

      let score = 0;
      if (hasLength) score++;
      if (hasUpper) score++;
      if (hasNumber) score++;
      if (hasSpecial) score++;

      ruleLength.textContent = `${hasLength ? '✓' : '✗'} 8+ characters`;
      ruleUpper.textContent = `${hasUpper ? '✓' : '✗'} Uppercase letter`;
      ruleNumber.textContent = `${hasNumber ? '✓' : '✗'} Number`;
      ruleSpecial.textContent = `${hasSpecial ? '✓' : '✗'} Special character`;

      if(score<=1){
        strengthFill.style.width = '25%';
        strengthText.textContent = 'Weak';
        strengthFill.style.background = 'repeating-linear-gradient(90deg,#ff7a18 0,#ff7a18 18px,transparent 18px,transparent 22px)';}
      else if(score<=3){
        strengthFill.style.width = '60%';
        strengthText.textContent = 'Medium';
        strengthFill.style.background = 'repeating-linear-gradient(90deg,#ff9d2f 0,#ff9d2f 18px,transparent 18px,transparent 22px)';}
      else{ 
        strengthFill.style.width = '100%';
        strengthText.textContent = 'Strong';
        strengthFill.style.background = 'repeating-linear-gradient(90deg,#ffb347 0,#ffb347 18px,transparent 18px,transparent 22px)';}
    }

  // Define creator vs crew roles for smart filtering
  const CREATOR_ROLES = ['Director', 'Writer', 'Producer'];
  const CREW_ROLES = ['Cinematographer / DP', 'Editor', 'Sound Designer', 'Designer', 'Actor', 'Lighting Crew', 'Set Support', 'Other'];

  // ── STEP NAVIGATION FUNCTIONS ──

  function navigateToStep(stepNum) {
    if (stepNum < 1 || stepNum > 3) return;

    // Hide all steps
    steps.forEach(step => step.classList.remove('active'));
    progressSteps.forEach(p => p.classList.remove('active'));

    // Show active step
    const targetStep = registerForm.querySelector(`.wizard-step[data-step="${stepNum}"]`);
    if (targetStep) targetStep.classList.add('active');

    // Update progress bar status
    for (let i = 1; i <= stepNum; i++) {
      const pStep = registerForm.querySelector(`.progress-step[data-step="${i}"]`);
      if (pStep) pStep.classList.add('active');
    }

    currentStep = stepNum;
  }

  // Reset Wizard to step 1
  window.resetRegisterWizard = function() {
    navigateToStep(1);
    // Deselect cards
    if (cardCreator) cardCreator.classList.remove('selected');
    if (cardCrew) cardCrew.classList.remove('selected');
    // Reset dropdown filter
    restoreAllRoles();
  };

  // Listen for register modal opens/closes to reset
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
        if (!registerModal.classList.contains('show')) {
          window.resetRegisterWizard();
        }
      }
    });
  });
  if (registerModal) {
    observer.observe(registerModal, { attributes: true });
  }

  // ── PATHWAY CARD EVENT HANDLERS ──

  if (cardCreator && cardCrew && selectRole) {
    cardCreator.addEventListener('click', () => {
      cardCreator.classList.add('selected');
      cardCrew.classList.remove('selected');
      filterRoles(CREATOR_ROLES);
      selectRole.focus();
    });

    cardCrew.addEventListener('click', () => {
      cardCrew.classList.add('selected');
      cardCreator.classList.remove('selected');
      filterRoles(CREW_ROLES);
      selectRole.focus();
    });
  }

  function filterRoles(allowedRoles) {
    // Clear options first, but preserve placeholder
    const options = selectRole.querySelectorAll('option');
    options.forEach(opt => {
      if (opt.value === "") {
        opt.disabled = true;
        opt.selected = true;
        return;
      }

      const isAllowed = allowedRoles.includes(opt.value);
      if (isAllowed) {
        opt.style.display = 'block';
        opt.disabled = false;
      } else {
        opt.style.display = 'none';
        opt.disabled = true;
      }
    });
  }

  function restoreAllRoles() {
    if (!selectRole) return;
    const options = selectRole.querySelectorAll('option');
    options.forEach(opt => {
      opt.style.display = 'block';
      opt.disabled = false;
      if (opt.value === "") {
        opt.disabled = true;
        opt.selected = true;
      }
    });
  }

  // ── STEP VALIDATIONS ──

  function validateStep1() {
    const name = document.getElementById('registerName');
    const email = document.getElementById('registerEmail');
    const password = document.getElementById('registerPassword');
    const confirmPassword = document.getElementById('registerConfirmPassword');

    if (!name.value.trim()) {
      showValidationMessage(name, 'Please enter your full name.');
      return false;
    }

    if (!email.value.trim() || !validateEmailFormat(email.value)) {
      showValidationMessage(email, 'Please enter a valid email address.');
      return false;
    }

    if (!password.value || password.value.length < 8) {
      showValidationMessage(password, 'Password must be at least 8 characters.');
      return false;
    }

    if (password.value !== confirmPassword.value) {
      showValidationMessage(confirmPassword, 'Passwords do not match.');
      return false;
    }

    return true;
  }

  function validateStep2() {
    const role = document.getElementById('registerRole');
    const dispPref = document.getElementById('registerDisplayPreference');

    // Check if pathway is chosen (at least one selected)
    const pathwayChosen = (cardCreator && cardCreator.classList.contains('selected')) ||
                          (cardCrew && cardCrew.classList.contains('selected'));

    if (!pathwayChosen) {
      showToast('Please select your Pathway (Creator or Crew).');
      return false;
    }

    if (!role.value) {
      showValidationMessage(role, 'Please select your core specialty role.');
      return false;
    }

    if (!dispPref.value) {
      showValidationMessage(dispPref, 'Please select your display preference.');
      return false;
    }

    return true;
  }

  function validateEmailFormat(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email.toLowerCase());
  }

  function showValidationMessage(inputEl, msg) {
    if (inputEl.reportValidity) {
      inputEl.setCustomValidity(msg);
      inputEl.reportValidity();
      // Clear message on input focus
      inputEl.addEventListener('input', function clearVal() {
        inputEl.setCustomValidity('');
        inputEl.removeEventListener('input', clearVal);
      });
    } else {
      showToast(msg);
    }
  }

  function showToast(msg) {
    const toast = document.getElementById('toast');
    if (toast) {
      toast.textContent = msg;
      toast.classList.add('show');
      setTimeout(() => toast.classList.remove('show'), 3500);
    }
  }

  // ── BUTTON CLICK BINDINGS ──

  if (btnNext1) {
    btnNext1.addEventListener('click', () => {
      if (validateStep1()) {
        navigateToStep(2);
      }
    });
  }

  if (btnBack1) {
    btnBack1.addEventListener('click', () => {
      navigateToStep(1);
    });
  }

  if (btnNext2) {
    btnNext2.addEventListener('click', () => {
      if (validateStep2()) {
        navigateToStep(3);
      }
    });
  }

  if (btnBack2) {
    btnBack2.addEventListener('click', () => {
      navigateToStep(2);
    });
  }
})();
