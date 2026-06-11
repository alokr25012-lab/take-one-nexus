/* Logic moved to /scripts/animations/common.js and /scripts/components/ui.js */

/* ── GENRE FILTER (Live Script Cards) ── */
function filterCards(genre, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  activeGenreFilter = genre || 'all';
  loadLiveScripts();
}

/* ── ROLE-BASED DYNAMIC FORMS CONFIG ── */
const ROLE_FORMS = {
    "Director": [
        { id: 'workTitle', label: 'Film Title', type: 'text', placeholder: 'e.g. Moonlight Sonata', required: true },
        { id: 'workGenre', label: 'Genre', type: 'select', options: ['Drama', 'Horror', 'Romance', 'Action', 'Thriller', 'Sci-Fi', 'Comedy'], required: true },
        { id: 'workSynopsis', label: 'Director Vision / Synopsis', type: 'textarea', placeholder: 'Describe your visual style and story...', full: true, required: true },
        { id: 'workTeam', label: 'Team Needed', type: 'text', placeholder: 'DP, Sound, Editor, Actors...' },
        { id: 'workPoster', label: 'Poster / Moodboard', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Drive / Pitch Deck Link', type: 'url', placeholder: 'https://drive.google.com/...' }
    ],
    "Writer": [
        { id: 'workTitle', label: 'Script Title', type: 'text', placeholder: 'e.g. The Last Train', required: true },
        { id: 'workGenre', label: 'Genre', type: 'select', options: ['Drama', 'Horror', 'Romance', 'Action', 'Thriller', 'Sci-Fi', 'Comedy'], required: true },
        { id: 'workSynopsis', label: 'Story Synopsis', type: 'textarea', placeholder: 'What is your story about?', full: true, required: true },
        { id: 'workTeam', label: 'Looking For', type: 'text', placeholder: 'Director, Producer...' },
        { id: 'workPoster', label: 'Script Cover', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Script PDF / Drive Link', type: 'url', placeholder: 'https://drive.google.com/...' }
    ],
    "Cinematographer / DP": [
        { id: 'workTitle', label: 'Project Name', type: 'text', required: true },
        { id: 'workCamera', label: 'Camera Used', type: 'text', placeholder: 'e.g. Alexa Mini, Red Komodo' },
        { id: 'workStyle', label: 'Visual Style', type: 'text', placeholder: 'e.g. High Contrast, Naturalistic' },
        { id: 'workSynopsis', label: 'Experience Description', type: 'textarea', placeholder: 'Describe your role and challenges...', full: true },
        { id: 'workPoster', label: 'Still / Frame', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Showreel / Video Link', type: 'url', placeholder: 'https://youtube.com/...' }
    ],
    "Editor": [
        { id: 'workTitle', label: 'Project Name', type: 'text', required: true },
        { id: 'workSoftware', label: 'Software Used', type: 'text', placeholder: 'e.g. Premiere Pro, DaVinci Resolve' },
        { id: 'workSynopsis', label: 'Before/After Description', type: 'textarea', placeholder: 'How did you transform the raw footage?', full: true },
        { id: 'workPoster', label: 'Timeline Screenshot', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Video Link', type: 'url', placeholder: 'https://vimeo.com/...' }
    ],
    "Designer": [
        { id: 'workTitle', label: 'Project Name', type: 'text', required: true },
        { id: 'workType', label: 'Design Type', type: 'text', placeholder: 'e.g. Poster, UI, Motion' },
        { id: 'workTools', label: 'Tools Used', type: 'text', placeholder: 'e.g. Photoshop, Figma, AE' },
        { id: 'workSynopsis', label: 'Design Concept', type: 'textarea', placeholder: 'Describe the design thinking...', full: true },
        { id: 'workPoster', label: 'Design File / Cover', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Portfolio Link', type: 'url', placeholder: 'https://behance.net/...' }
    ],
    "Actor": [
        { id: 'workTitle', label: 'Role Name', type: 'text', required: true },
        { id: 'workProject', label: 'Project Name', type: 'text' },
        { id: 'workSynopsis', label: 'Experience Description', type: 'textarea', placeholder: 'Describe your character and performance...', full: true },
        { id: 'workPoster', label: 'Headshot / Frame', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Showreel Link', type: 'url', placeholder: 'https://youtube.com/...' }
    ],
    "Sound Designer": [
        { id: 'workTitle', label: 'Project Name', type: 'text', required: true },
        { id: 'workAudioType', label: 'Audio Type', type: 'text', placeholder: 'e.g. Sound Design, Mix, Score' },
        { id: 'workSoftware', label: 'DAW Used', type: 'text', placeholder: 'e.g. Pro Tools, Ableton' },
        { id: 'workSynopsis', label: 'Audio Breakdown', type: 'textarea', placeholder: 'Describe the soundscape...', full: true },
        { id: 'workLink', label: 'Audio / Video Link', type: 'url', placeholder: 'https://soundcloud.com/...' }
    ],
    "Other": [
        { id: 'workTitle', label: 'Project Name', type: 'text', required: true },
        { id: 'workRole', label: 'Role Played', type: 'text' },
        { id: 'workSynopsis', label: 'Work Description', type: 'textarea', placeholder: 'Describe your contribution...', full: true },
        { id: 'workPoster', label: 'Cover Image', type: 'file', accept: 'image/*' },
        { id: 'workLink', label: 'Link', type: 'url' }
    ]
};

function renderDynamicUploadForm(user) {
    const container = document.getElementById('dynamicFormFields');
    if (!container) return;
    
    const role = user?.role || "Director";
    const fields = ROLE_FORMS[role] || ROLE_FORMS["Other"];
    
    container.innerHTML = fields.map((field, index) => {
        const num = String(index + 1).padStart(2, '0');
        const fullClass = field.full ? 'upload-full' : '';
        
        let inputHtml = '';
        if (field.type === 'select') {
            inputHtml = `<select id="${field.id}">
                ${field.options.map(opt => `<option value="${opt.toLowerCase()}">${opt}</option>`).join('')}
            </select>`;
        } else if (field.type === 'textarea') {
            inputHtml = `<textarea id="${field.id}" placeholder="${field.placeholder || ''}"></textarea>`;
        } else if (field.type === 'file') {
            inputHtml = `<input type="file" id="${field.id}" accept="${field.accept || '*'}">`;
        } else {
            inputHtml = `<input type="${field.type}" id="${field.id}" placeholder="${field.placeholder || ''}">`;
        }
        
        return `
            <div class="upload-panel ${fullClass}">
                <div class="data-num">${num}</div>
                <label for="${field.id}">${field.label}${field.required ? ' *' : ''}</label>
                ${inputHtml}
            </div>
        `;
    }).join('');

    // Initialize premium interactive submission wizard elements (Logline Builder & Crew Planner)
    if (typeof SubmissionHelper !== 'undefined') {
        SubmissionHelper.init();
    }
}

function loadRazorpaySDK() {
    return new Promise((resolve) => {
        if (typeof Razorpay !== 'undefined') {
            resolve(true);
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://checkout.razorpay.com/v1/checkout.js';
        script.onload = () => resolve(true);
        script.onerror = () => resolve(false);
        document.body.appendChild(script);
    });
}

async function uploadWork() {
    const user = API.auth.getUser();
    if (!user) {
        showToast('Please login to upload work ✦');
        return;
    }
    
    const role = user.role || "Director";
    const fields = ROLE_FORMS[role] || ROLE_FORMS["Other"];
    
    const payload = {
        work_type: role,
        role_data: {}
    };
    
    // Collect data
    for (const field of fields) {
        const el = document.getElementById(field.id);
        if (!el) continue;
        
        if (field.type === 'file') {
            // In this MVP, we don't handle real file uploads to S3, 
            // but we can simulate the "Just Added" card behavior with local preview
            if (el.files && el.files[0]) {
                payload.localFile = el.files[0];
            }
        } else {
            const val = el.value.trim();
            if (field.required && !val) {
                showToast(`Please enter ${field.label} ✦`);
                return;
            }
            
            // Map to standard fields where possible
            if (field.id === 'workTitle') payload.title = val;
            else if (field.id === 'workGenre') payload.genre = val;
            else if (field.id === 'workSynopsis') payload.synopsis = val;
            else if (field.id === 'workTeam') payload.roles_needed = val;
            else if (field.id === 'workLink') payload.media_links = val;
            else {
                payload.role_data[field.id] = val;
            }
        }
    }
    
    const submitBtn = document.getElementById('uploadActionButton');
    const originalText = submitBtn ? submitBtn.textContent : 'TRANSMIT SIGNAL';

    try {
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Preparing Order...';
        }

        // Serialize role_data
        const finalPayload = {
            ...payload,
            role_data: JSON.stringify(payload.role_data)
        };

        // Step 1: Create Razorpay order + draft via backend
        const orderRes = await API.payments.createOrder(finalPayload);
        if (!orderRes.success) throw new Error(orderRes.message || 'Order creation failed');

        const { order_id, draft_id, amount, currency, key_id, is_simulated, is_founder } = orderRes;

        if (is_founder) {
            showTransmissionAccepted(payload.title);
            renderDynamicUploadForm(user);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = originalText;
            }
            return;
        }

        if (is_simulated) {
            throw new Error('Payment gateway unavailable. Script was not submitted.');
        }

        if (submitBtn) submitBtn.textContent = 'Opening Payment...';

        // Ensure Razorpay SDK is fully loaded
        const sdkLoaded = await loadRazorpaySDK();
        if (!sdkLoaded || typeof Razorpay === 'undefined') {
            API.payments.cancel({ draft_id, razorpay_order_id: order_id }).catch(() => {});
            throw new Error('Razorpay payment gateway failed to load. Please check your internet connection.');
        }

        await new Promise((resolve, reject) => {
            const options = {
                key: key_id,
                amount,
                currency,
                name: 'TAKE ONE',
                description: `Script Submission: ${payload.title}`,
                image: '/assets/logo-icon.png',
                order_id,
                theme: { color: '#ff4d1a' },
                modal: {
                    ondismiss() {
                        API.payments.cancel({ draft_id, razorpay_order_id: order_id }).catch(() => {});
                        reject(new Error('UPLOAD CANCELLED'));
                    }
                },
                handler: async function(rzpResponse) {
                    try {
                        if (submitBtn) submitBtn.textContent = 'Verifying...';
                        const verifyRes = await API.payments.verify({
                            razorpay_order_id: rzpResponse.razorpay_order_id,
                            razorpay_payment_id: rzpResponse.razorpay_payment_id,
                            razorpay_signature: rzpResponse.razorpay_signature,
                            draft_id
                        });
                        if (!verifyRes.success) throw new Error(verifyRes.message || 'PAYMENT FAILED — SCRIPT NOT SUBMITTED');
                        showTransmissionAccepted(payload.title);
                        renderDynamicUploadForm(user);
                        resolve();
                    } catch (verifyErr) {
                        reject(verifyErr);
                    }
                }
            };

            if (typeof Razorpay === 'undefined') {
                API.payments.cancel({ draft_id, razorpay_order_id: order_id }).catch(() => {});
                reject(new Error('Razorpay SDK not loaded'));
                return;
            }

            const rzp = new Razorpay(options);
            rzp.on('payment.failed', function(resp) {
                API.payments.cancel({ draft_id, razorpay_order_id: order_id }).catch(() => {});
                reject(new Error(resp.error?.description || 'PAYMENT FAILED — SCRIPT NOT SUBMITTED'));
            });
            rzp.open();
        });
    } catch (err) {
        if (err.message === 'UPLOAD CANCELLED') {
            showToast('UPLOAD CANCELLED');
        } else {
            console.error('Upload/payment error:', err.message);
            showTransmissionLost(err.message, () => uploadWork());
        }
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = originalText;
        }
    }
}

/* Utility functions moved to /scripts/utils/helpers.js and /scripts/components/ui.js */

/* Scroll progress moved to /scripts/animations/common.js */

/**
 * TRANSMISSION LOST — cinematic overlay shown when an API signal fails.
 * @param {string} reason   — short error message to display
 * @param {Function} retryFn — callback to call when user clicks RETRY SIGNAL
 */
function showTransmissionLost(reason, retryFn) {
  // Remove any existing overlay
  document.getElementById('__txLostOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__txLostOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.85);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: 'Space Mono', monospace;
    animation: __txFadeIn 0.4s ease forwards;
    backdrop-filter: blur(4px);
  `;

  overlay.innerHTML = `
    <style>
      @keyframes __txFadeIn { from { opacity: 0; } to { opacity: 1; } }
      @keyframes __txScanline {
        0%   { background-position: 0 0; }
        100% { background-position: 0 100vh; }
      }
      @keyframes __txPulse {
        0%, 100% { opacity: 1; text-shadow: 0 0 20px #ff4d1a, 0 0 40px #ff2200; }
        50%       { opacity: 0.5; text-shadow: 0 0 4px #ff4d1a; }
      }
      @keyframes __txRetryPulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,77,26,0.6); }
        70%       { box-shadow: 0 0 0 12px rgba(255,77,26,0); }
      }
      #__txLostOverlay::before {
        content: '';
        position: absolute; inset: 0; pointer-events: none;
        background: repeating-linear-gradient(
          0deg,
          rgba(255, 77, 26, 0.03) 0px,
          rgba(255, 77, 26, 0.03) 1px,
          transparent 1px,
          transparent 3px
        );
        animation: __txScanline 8s linear infinite;
      }
      #__txRetryBtn:hover {
        background: rgba(255,77,26,0.15);
        border-color: #ff4d1a;
        box-shadow: 0 0 20px rgba(255,77,26,0.4), 0 0 40px rgba(255,77,26,0.2);
        transform: scale(1.05);
      }
      #__txDismissBtn:hover {
        color: rgba(255,255,255,0.5);
        text-shadow: 0 0 10px rgba(255,255,255,0.3);
      }
    </style>

    <div style="text-align:center; position:relative; z-index:1; max-width:520px; padding:0 24px;">
      <div style="font-size:11px; letter-spacing:0.25em; color:rgba(255,77,26,0.6); text-transform:uppercase; margin-bottom:12px;">
        TAKE ONE / SIGNAL STATUS
      </div>

      <div style="
        font-family:'Bebas Neue',sans-serif;
        font-size:clamp(48px,10vw,96px);
        line-height:1;
        color:#ff4d1a;
        animation: __txPulse 1.8s ease-in-out infinite;
        letter-spacing:0.04em;
        margin-bottom:8px;
      ">TRANSMISSION<br>LOST</div>

      <div style="
        font-size:11px; letter-spacing:0.12em; color:rgba(255,255,255,0.35);
        text-transform:uppercase; margin-bottom:32px; line-height:1.7;
      ">
        SIGNAL INTERRUPTED — DATABASE UNREACHABLE<br>
        <span style="color:rgba(255,77,26,0.5);">${reason ? reason.replace(/</g,'&lt;').replace(/>/g,'&gt;').substring(0, 80) : 'UNKNOWN ERROR'}</span>
      </div>

      <button id="__txRetryBtn" style="
        background: transparent;
        border: 1px solid rgba(255,77,26,0.7);
        color: #ff4d1a;
        font-family: 'Space Mono', monospace;
        font-size: 11px;
        letter-spacing: 0.22em;
        text-transform: uppercase;
        padding: 14px 36px;
        cursor: pointer;
        animation: __txRetryPulse 2s infinite;
        transition: all 0.2s ease;
        margin-bottom: 16px;
      ">RETRY SIGNAL</button>

      <div style="display:block;">
        <button id="__txDismissBtn" style="
          background: none; border: none;
          color: rgba(255,255,255,0.2);
          font-family: 'Space Mono', monospace;
          font-size: 9px; letter-spacing: 0.2em;
          text-transform: uppercase; cursor: pointer;
          padding: 8px;
          transition: all 0.2s ease;
        ">DISMISS</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#__txRetryBtn').addEventListener('click', () => {
    overlay.style.animation = 'none';
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => overlay.remove(), 300);
    if (typeof retryFn === 'function') retryFn();
  });

  overlay.querySelector('#__txDismissBtn').addEventListener('click', () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.3s ease';
    setTimeout(() => overlay.remove(), 300);
  });
}

/**
 * TRANSMISSION ACCEPTED — cinematic flash shown when a script upload succeeds.
 * @param {string} title — title of the script that was transmitted
 */
function showTransmissionAccepted(title) {
  document.getElementById('__txAcceptOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = '__txAcceptOverlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 9999;
    background: rgba(0, 0, 0, 0.88);
    display: flex; flex-direction: column;
    align-items: center; justify-content: center;
    font-family: 'Space Mono', monospace;
    animation: __txFadeIn 0.3s ease forwards;
    pointer-events: none;
  `;

  overlay.innerHTML = `
    <style>
      @keyframes __txAcceptFlash {
        0%   { opacity: 0; transform: scale(0.94); }
        20%  { opacity: 1; transform: scale(1.02); }
        100% { opacity: 0; transform: scale(1); }
      }
      @keyframes __txGreenPulse {
        0%, 100% { text-shadow: 0 0 20px #00ff88, 0 0 40px #00cc66; }
        50%       { text-shadow: 0 0 4px #00ff88; }
      }
    </style>
    <div style="
      text-align:center;
      animation: __txAcceptFlash 3s ease forwards;
      max-width:480px; padding:0 24px;
    ">
      <div style="font-size:11px; letter-spacing:0.25em; color:rgba(0,255,136,0.5); text-transform:uppercase; margin-bottom:12px;">
        TAKE ONE / SIGNAL STATUS
      </div>
      <div style="
        font-family:'Bebas Neue',sans-serif;
        font-size:clamp(48px,10vw,96px);
        line-height:1;
        color:#00ff88;
        animation: __txGreenPulse 1.4s ease-in-out 3;
        letter-spacing:0.04em;
        margin-bottom:8px;
      ">TRANSMISSION<br>ACCEPTED</div>
      <div style="font-size:11px; letter-spacing:0.12em; color:rgba(255,255,255,0.35); text-transform:uppercase; margin-top:16px;">
        "${(title || 'YOUR WORK').toUpperCase()}" IS NOW PENDING REVIEW
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 3200);
}

function scrollToSection(selector) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openCrewFinderPage(role = '') {
  const query = role ? `?role=${encodeURIComponent(role)}` : '';
  window.location.href = `/crew${query}`;
}

/* Role helpers moved to /scripts/utils/helpers.js */

let CREW_ROLE_OPTIONS = [];
if (window.TAKE_ONE_ROLES) {
  CREW_ROLE_OPTIONS = window.TAKE_ONE_ROLES.map(role => {
    let label = role + 's';
    if (role === 'Other') label = 'Other Crew';
    if (role.includes('/')) label = role.split('/')[0].trim() + 's';
    
    return {
      key: window.ROLE_SLUGS[role],
      query: role,
      label: label,
      icon: window.ROLE_ICONS[role] || '◎'
    };
  });
}

const ROLE_WORKSPACES = {
  guest: {
    label: 'Login',
    title: 'Choose Your Role Workspace',
    subtitle: 'Login first, then TAKE ONE will show the correct workspace for your film role.',
    heading: 'Login To Unlock Your Workspace',
    description: 'Directors and writers can post scripts. Camera, lights, sound, actors, editors, and set crew get a different workspace for finding projects.',
    list: [
      'Create or login to your account',
      'Pick your real role during registration',
      'Your dashboard changes automatically'
    ],
    primary: 'Browse Live Scripts →',
    secondary: 'Create Profile'
  },
  director: {
    label: 'Director',
    title: 'Director Project Desk',
    subtitle: 'Post your film idea, list crew needs, and let available collaborators request to join.',
    scriptLabel: 'Project / Film Title',
    scriptPlaceholder: 'Enter the film or scene title',
    descLabel: 'Director Vision',
    descPlaceholder: 'Describe your visual style, story, tone, locations, and crew you need.',
    rolesLabel: 'Crew Needed',
    rolesPlaceholder: 'DP, Gaffer, Sound, Editor, Actors...',
    button: 'Post Director Call →',
    status: 'Director call is live. Crew members can request to join.'
  },
  writer: {
    label: 'Writer',
    title: 'Writer Script Desk',
    subtitle: 'Share your screenplay or story idea so directors and producers can discover it.',
    scriptLabel: 'Script Title',
    scriptPlaceholder: 'Enter your screenplay title',
    descLabel: 'Story Synopsis',
    descPlaceholder: 'Describe your story, genre, main characters, and what kind of team it needs.',
    rolesLabel: 'Looking For',
    rolesPlaceholder: 'Director, producer, actors, editor...',
    button: 'Submit Script →',
    status: 'Script is live. Creators can discover and contact you.'
  },
  producer: {
    label: 'Producer',
    title: 'Producer Hiring Desk',
    subtitle: 'Create a production call and list the departments you want to bring together.',
    scriptLabel: 'Production Title',
    scriptPlaceholder: 'Enter your production title',
    descLabel: 'Production Brief',
    descPlaceholder: 'Describe budget style, timeline, locations, and team requirements.',
    rolesLabel: 'Departments Needed',
    rolesPlaceholder: 'Director, camera, lights, art, sound, edit...',
    button: 'Post Production Call →',
    status: 'Production call is live for your crew search.'
  },
  camera: {
    label: 'Camera',
    title: 'Camera Opportunities',
    subtitle: 'This workspace is for camera people. Directors cannot see this mode unless they register as camera crew.',
    heading: 'Camera Department',
    description: 'Find scripts and director calls that need cinematographers, DPs, camera operators, or camera assistants.',
    list: [
      'Browse live scripts that need camera crew',
      'Send a join request to the project owner',
      'Keep your profile ready with reel, camera skills, and city'
    ],
    primary: 'Find Camera Projects →',
    secondary: 'Update Camera Profile'
  },
  gaffer: {
    label: 'Lights',
    title: 'Lighting Opportunities',
    subtitle: 'This workspace is for gaffers and lighting crew. It focuses only on light-related project needs.',
    heading: 'Lighting Department',
    description: 'Find productions that need gaffers, light assistants, and people who can shape the look of a scene.',
    list: [
      'Browse projects asking for gaffer or lighting help',
      'Request to join productions directly',
      'Add your lighting skills and gear knowledge to profile'
    ],
    primary: 'Find Lighting Projects →',
    secondary: 'Update Lighting Profile'
  },
  sound: {
    label: 'Sound',
    title: 'Sound Opportunities',
    subtitle: 'This workspace is for sound recordists, designers, and audio crew.',
    heading: 'Sound Department',
    description: 'Find productions that need sync sound, dubbing, sound design, or final mix support.',
    list: [
      'Browse live scripts that mention sound or audio needs',
      'Send requests to productions from script cards',
      'Use your profile to show sound gear and audio skills'
    ],
    primary: 'Find Sound Projects →',
    secondary: 'Update Sound Profile'
  },
  editor: {
    label: 'Editor',
    title: 'Post Production Desk',
    subtitle: 'This workspace is for editors and post-production crew.',
    heading: 'Post Production',
    description: 'Find films looking for editors, color work, trailer cuts, or finishing help.',
    list: [
      'Browse scripts looking for edit or post support',
      'Request to join projects that match your style',
      'Add portfolio links and software skills to your profile'
    ],
    primary: 'Find Edit Projects →',
    secondary: 'Update Editor Profile'
  },
  designer: {
    label: 'Designer',
    title: 'Design Opportunities',
    subtitle: 'This workspace is for UI/UX, Motion, and Graphic Designers.',
    heading: 'Design Department',
    description: 'Find productions that need poster design, branding, UI interfaces, and motion graphics.',
    list: [
      'Browse scripts looking for design support',
      'Request to join projects that match your style',
      'Add portfolio links and software skills to your profile'
    ],
    primary: 'Find Design Projects →',
    secondary: 'Update Designer Profile'
  },
  actor: {
    label: 'Actor',
    title: 'Casting Opportunities',
    subtitle: 'This workspace is for actors. It shows project calls where casting is open.',
    heading: 'Casting Desk',
    description: 'Find scripts and directors looking for actors, performers, and screen tests.',
    list: [
      'Browse live projects with casting needs',
      'Request to join from script cards',
      'Keep your city, photos, and acting bio updated'
    ],
    primary: 'Find Casting Calls →',
    secondary: 'Update Actor Profile'
  },
  spot: {
    label: 'Set Crew',
    title: 'Set Support Desk',
    subtitle: 'This workspace is for spot crew, runners, and production support.',
    heading: 'Set Support',
    description: 'Find productions that need reliable on-set help, logistics, and support crew.',
    list: [
      'Browse productions looking for set support',
      'Request to join active teams',
      'Show your availability, city, and experience on profile'
    ],
    primary: 'Find Set Work →',
    secondary: 'Update Crew Profile'
  },
  defaultCrew: {
    label: 'Workspace',
    title: 'Crew Opportunities',
    subtitle: 'This workspace is for crew members to find productions and request to join.',
    heading: 'Crew Mode',
    description: 'Browse active scripts, find productions that need your role, and let your profile do the talking.',
    list: [
      'Browse open scripts and production needs',
      'Send live requests to project owners',
      'Keep your profile updated for faster replies'
    ],
    primary: 'Browse Open Scripts →',
    secondary: 'Build Crew Profile'
  }
};

function getWorkspaceForRole(role) {
  const normalized = normalizeRole(role);

  if (!normalized) return ROLE_WORKSPACES.guest;
  if (normalized.includes('director')) return ROLE_WORKSPACES.director;
  if (normalized.includes('writer') || normalized.includes('screenwriter')) return ROLE_WORKSPACES.writer;
  if (normalized.includes('producer')) return ROLE_WORKSPACES.producer;
  if (normalized.includes('camera') || normalized.includes('cinematographer') || normalized.includes('dp')) return ROLE_WORKSPACES.camera;
  if (normalized.includes('gaffer') || normalized.includes('light')) return ROLE_WORKSPACES.gaffer;
  if (normalized.includes('sound')) return ROLE_WORKSPACES.sound;
  if (normalized.includes('editor')) return ROLE_WORKSPACES.editor;
  if (normalized.includes('designer')) return ROLE_WORKSPACES.designer;
  if (normalized.includes('actor')) return ROLE_WORKSPACES.actor;
  if (normalized.includes('spot')) return ROLE_WORKSPACES.spot;

  return ROLE_WORKSPACES.defaultCrew;
}

function getRoleSkinKey(role) {
  const normalized = normalizeRole(role);

  if (normalized.includes('director')) return 'director';
  if (normalized.includes('camera') || normalized.includes('cinematographer') || normalized.includes('dp')) return 'camera';
  if (normalized.includes('actor')) return 'actor';
  if (normalized.includes('writer') || normalized.includes('screenwriter')) return 'writer';
  if (normalized.includes('producer')) return 'producer';
  if (normalized.includes('gaffer') || normalized.includes('light')) return 'gaffer';
  if (normalized.includes('sound')) return 'sound';
  if (normalized.includes('editor')) return 'editor';
  if (normalized.includes('designer')) return 'designer';
  if (normalized.includes('spot')) return 'spot';

  return 'crew';
}

function applyRoleSkin(role) {
  document.body.classList.remove(
    'role-skin-director',
    'role-skin-camera',
    'role-skin-actor',
    'role-skin-writer',
    'role-skin-producer',
    'role-skin-gaffer',
    'role-skin-sound',
    'role-skin-editor',
    'role-skin-designer',
    'role-skin-spot',
    'role-skin-crew'
  );

  document.body.classList.add(`role-skin-${getRoleSkinKey(role)}`);
}

function getRoleTools(role) {
  const key = getRoleSkinKey(role);
  const tools = {
    director: [
      ['Script Command', 'Post a project, define the tone, and list the departments you need.'],
      ['Crew Breakdown', 'See which roles are available before your first production call.'],
      ['Request Inbox', 'Review people asking to join your scripts from Profile.']
    ],
    camera: [
      ['Shot Match', 'Find projects asking for DP, cinematographer, or camera support.'],
      ['Gear Board', 'Use your profile to show cameras, lenses, rigs, and shooting style.'],
      ['Visual Pitch', 'Request projects with a short note about how you would shoot the scene.']
    ],
    actor: [
      ['Casting Calls', 'Focus on projects with actors, casting, or performance needs.'],
      ['Audition Slate', 'Keep your role, city, skills, and profile ready for directors.'],
      ['Character Match', 'Open script previews and request the roles that fit your screen presence.']
    ],
    writer: [
      ['Story Desk', 'Publish scripts and story ideas for directors to discover.'],
      ['Collab Needs', 'Mention if you need a director, producer, actors, or editor.'],
      ['Work Signal', 'Your newest work appears in the live work showcase.']
    ],
    producer: [
      ['Production Call', 'Post a production brief and assemble the departments needed.'],
      ['Department Map', 'Track director, camera, light, sound, edit, and cast needs.'],
      ['Collab Inbox', 'Use Profile to see who has requested to join.']
    ],
    gaffer: [
      ['Lighting Calls', 'Find productions asking for gaffer or lighting support.'],
      ['Look Builder', 'Show lighting skills and gear knowledge in your profile.'],
      ['Set Ready', 'Request projects where mood, contrast, and exposure matter.']
    ],
    sound: [
      ['Audio Calls', 'Find scripts needing sound recording, design, or mix support.'],
      ['Sound Kit', 'Show microphones, software, and cleanup skills in your profile.'],
      ['Post Audio', 'Request films where dialogue, ambience, or sound design is important.']
    ],
    editor: [
      ['Edit Calls', 'Find projects asking for editor, trailer cut, or post-production help.'],
      ['Timeline Skills', 'Show editing software, color, sync, and storytelling strengths.'],
      ['Post Match', 'Request scripts that fit your editing taste.']
    ],
    designer: [
      ['Visual Pitch', 'Request projects by showing moodboards and visual ideas.'],
      ['Design Board', 'Use your profile to show past poster designs, UI, and branding.'],
      ['Asset Match', 'Find projects asking for UI interfaces, posters, or motion graphics.']
    ],
    spot: [
      ['Set Calls', 'Find productions that need support, logistics, and on-set help.'],
      ['Availability', 'Keep your city and availability clear for fast coordination.'],
      ['Production Support', 'Request teams that need reliable set crew.']
    ],
    crew: [
      ['Open Calls', 'Browse live scripts and production needs.'],
      ['Profile Card', 'Use your profile as your role card.'],
      ['Request Flow', 'Send live collaboration requests from script cards.']
    ]
  };

  return tools[key] || tools.crew;
}

function renderRoleToolkit(user, workspace) {
  const toolkit = document.getElementById('roleToolkit');
  const title = document.getElementById('roleToolkitTitle');
  const kicker = document.getElementById('roleToolkitKicker');
  const signal = document.getElementById('roleToolkitSignal');
  const grid = document.getElementById('roleToolGrid');
  const directorDesk = document.getElementById('directorDeskPanel');

  if (!toolkit || !grid) return;

  if (!user) {
    toolkit.hidden = true;
    if (directorDesk) directorDesk.hidden = true;
    return;
  }

  toolkit.hidden = false;
  if (title) title.textContent = workspace.title;
  if (kicker) kicker.textContent = `${user.role || 'Crew'} Interface`;
  if (signal) signal.textContent = getRoleSkinKey(user.role).toUpperCase();

  grid.innerHTML = getRoleTools(user.role).map((tool, index) => `
    <div class="role-tool-card">
      <span>${String(index + 1).padStart(2, '0')}</span>
      <strong>${tool[0]}</strong>
      <p>${tool[1]}</p>
    </div>
  `).join('');

  if (directorDesk) {
    const isDirector = getRoleSkinKey(user.role) === 'director';
    directorDesk.hidden = !isDirector;
    if (isDirector) updateDirectorDeskPreview();
  }
}

function setLabelText(forId, value) {
  const label = document.querySelector(`label[for="${forId}"]`);
  if (label && value) label.textContent = value;
}

function applyCreatorWorkspaceCopy(workspace) {
  setLabelText('scriptTitle', workspace.scriptLabel);
  setLabelText('scriptDesc', workspace.descLabel);
  setLabelText('authorName', workspace.rolesLabel);

  const titleEl = document.getElementById('scriptTitle');
  const descEl = document.getElementById('scriptDesc');
  const authorEl = document.getElementById('authorName');

  if (titleEl) titleEl.placeholder = workspace.scriptPlaceholder || '';
  if (descEl) descEl.placeholder = workspace.descPlaceholder || '';
  if (authorEl) authorEl.placeholder = workspace.rolesPlaceholder || '';
}

function applyCrewWorkspaceCopy(workspace) {
  const heading = document.getElementById('crewModeHeading');
  const description = document.getElementById('crewModeDescription');
  const list = document.getElementById('crewModeList');
  const browseAction = document.getElementById('crewBrowseAction');
  const profileAction = document.getElementById('crewProfileAction');

  if (heading) heading.textContent = workspace.heading;
  if (description) description.textContent = workspace.description;
  if (list) {
    list.innerHTML = workspace.list.map((item) => `<li>${item}</li>`).join('');
  }
  if (browseAction) browseAction.textContent = workspace.primary;
  if (profileAction) profileAction.textContent = workspace.secondary;
}

function getSelectedDirectorRoles() {
  return Array.from(document.querySelectorAll('.director-chip.active'))
    .map((chip) => chip.dataset.directorRole)
    .filter(Boolean);
}

function getDirectorDeskPitch() {
  const title = document.getElementById('scriptTitle')?.value.trim() || 'Untitled director call';
  const genre = document.getElementById('scriptTheme')?.value || 'drama';
  const synopsis = document.getElementById('scriptDesc')?.value.trim();
  const mood = document.getElementById('directorSceneMood')?.value || 'Gritty realistic';
  const location = document.getElementById('directorLocation')?.value.trim();
  const shootDate = document.getElementById('directorShootDate')?.value;
  const roles = getSelectedDirectorRoles();

  return {
    title,
    genre,
    synopsis,
    mood,
    location,
    shootDate,
    roles
  };
}

function updateDirectorDeskPreview() {
  const preview = document.getElementById('directorDeskPreview');
  const state = document.getElementById('directorDeskState');
  const value = document.getElementById('directorReadinessValue');
  const bar = document.getElementById('directorReadinessBar');
  const pitch = getDirectorDeskPitch();
  const readinessParts = [
    pitch.title !== 'Untitled director call',
    Boolean(pitch.synopsis),
    Boolean(pitch.location),
    pitch.roles.length > 0,
    Boolean(pitch.shootDate)
  ];
  const readiness = Math.max(20, Math.round((readinessParts.filter(Boolean).length / readinessParts.length) * 100));
  const dateLine = pitch.shootDate ? `Shoot window: ${pitch.shootDate}. ` : '';
  const locationLine = pitch.location ? `Location idea: ${pitch.location}. ` : '';
  const rolesLine = pitch.roles.length ? `Needs: ${pitch.roles.join(', ')}.` : 'Needs: select crew roles.';
  const storyLine = pitch.synopsis ? `Story: ${pitch.synopsis}` : 'Story: add a short director vision in the synopsis box.';

  if (preview) {
    preview.textContent = `${pitch.title} is a ${pitch.genre} call with a ${pitch.mood.toLowerCase()} tone. ${locationLine}${dateLine}${rolesLine} ${storyLine}`;
  }

  if (value) value.textContent = `${readiness}%`;
  if (bar) bar.style.width = `${readiness}%`;
  if (state) state.textContent = readiness >= 80 ? 'Ready' : readiness >= 50 ? 'Building' : 'Draft';
}

function useDirectorDeskInUploadForm() {
  const pitch = getDirectorDeskPitch();
  const rolesEl = document.getElementById('authorName');
  const synopsisEl = document.getElementById('scriptDesc');
  const locationLine = pitch.location ? `Location: ${pitch.location}. ` : '';
  const dateLine = pitch.shootDate ? `Shoot window: ${pitch.shootDate}. ` : '';
  const generatedBrief = `${pitch.mood} tone. ${locationLine}${dateLine}Crew needed: ${pitch.roles.join(', ') || 'DP, Gaffer, Sound, Actors, Editor'}.`;

  if (rolesEl) rolesEl.value = pitch.roles.join(', ') || 'DP, Gaffer, Sound, Actors, Editor';
  if (synopsisEl && !synopsisEl.value.trim()) {
    synopsisEl.value = generatedBrief;
  } else if (synopsisEl && !synopsisEl.value.includes('Crew needed:')) {
    synopsisEl.value = `${synopsisEl.value.trim()}\n\n${generatedBrief}`;
  }

  updateDirectorDeskPreview();
  showToast('Director call added to upload form ✦');
  document.getElementById('creatorUploadZone')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function initDirectorDesk() {
  const watched = ['scriptTitle', 'scriptTheme', 'scriptDesc', 'authorName', 'directorSceneMood', 'directorLocation', 'directorShootDate'];

  watched.forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener('input', updateDirectorDeskPreview);
    el?.addEventListener('change', updateDirectorDeskPreview);
  });

  document.getElementById('directorCrewChips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('.director-chip');
    if (!chip) return;
    chip.classList.toggle('active');
    updateDirectorDeskPreview();
  });

  document.getElementById('directorBuildCallBtn')?.addEventListener('click', useDirectorDeskInUploadForm);
  document.getElementById('directorCrewFinderBtn')?.addEventListener('click', () => openCrewFinderPage());
  document.getElementById('directorInboxBtn')?.addEventListener('click', () => {
    window.location.href = '/profile#collab';
  });
}

let latestHomeStats = {};
let allLiveScripts = [];
let activeSearchQuery = '';
let activeGenreFilter = 'all';

/* Moved to helpers.js */

function normalizeScriptCard(script, index) {
  return {
    id: script.id,
    owner_id: script.owner_id || script.user_id || '',
    number: script.number || String(index + 1).padStart(3, '0'),
    title: script.title || 'Untitled Script',
    genre: script.genre || 'General',
    tag: script.tag || script.roles_needed || script.status || 'Open for collaboration',
    status: script.status || 'Live',
    synopsis: script.synopsis || '',
    author_name: script.author_name || 'TAKE ONE creator'
  };
}

function getNormalizedScriptById(scriptId) {
  const index = allLiveScripts.findIndex((script) => Number(script.id) === Number(scriptId));
  if (index === -1) return null;
  return normalizeScriptCard(allLiveScripts[index], index);
}

function roleKeywords(role) {
  const normalized = normalizeRole(role);

  if (normalized.includes('camera') || normalized.includes('cinematographer') || normalized.includes('dp')) {
    return ['camera', 'cinematographer', 'dp', 'dop', 'director of photography'];
  }
  if (normalized.includes('gaffer') || normalized.includes('light')) {
    return ['gaffer', 'light', 'lighting'];
  }
  if (normalized.includes('sound')) {
    return ['sound', 'audio', 'recordist'];
  }
  if (normalized.includes('editor')) {
    return ['editor', 'edit', 'post'];
  }
  if (normalized.includes('designer')) {
    return ['designer', 'design', 'ui/ux', 'motion graphics', 'poster'];
  }
  if (normalized.includes('actor')) {
    return ['actor', 'cast', 'casting', 'performer'];
  }
  if (normalized.includes('spot')) {
    return ['spot', 'runner', 'set support'];
  }

  return normalized ? [normalized] : [];
}

function scriptMatchesUserRole(script) {
  if (typeof API === 'undefined' || !API.auth?.isLoggedIn()) return false;

  const user = API.auth.getUser();
  if (!user || isCreatorRole(user.role)) return false;

  const keywords = roleKeywords(user.role);
  const haystack = normalizeRole(`${script.title} ${script.genre} ${script.tag} ${script.synopsis}`);

  return keywords.some((keyword) => haystack.includes(keyword));
}

function updateLiveScriptStatus(count, query = activeSearchQuery, genre = activeGenreFilter) {
  const status = document.getElementById('liveScriptStatus');
  if (!status) return;

  const filterText = [
    query ? `search: "${query}"` : '',
    genre && genre !== 'all' ? `genre: ${genre}` : ''
  ].filter(Boolean).join(' · ');

  status.textContent = `${count} live script${count === 1 ? '' : 's'} loaded${filterText ? ` · ${filterText}` : ''}`;
}

function renderHomepageScripts(scripts) {
  const cardRow = document.getElementById('cardRow');
  if (!cardRow || !Array.isArray(scripts)) return;
  const normalizedScripts = scripts.map(normalizeScriptCard);

  if (scripts.length === 0) {
    cardRow.innerHTML = `
      <div class="live-empty-card">
        No projects posted yet. Directors can post the first project here.
      </div>
    `;
    updateLiveScriptStatus(0);
    return;
  }

  cardRow.innerHTML = normalizedScripts.map((script) => `
    <div class="movie-card ${scriptMatchesUserRole(script) ? 'role-match-card' : ''}" data-script-id="${script.id}" data-owner-id="${script.owner_id || ''}" data-genre="${String(script.genre || 'general').toLowerCase()}"
      style="background: linear-gradient(160deg, ${getCardTone(script.genre)} 0%, #06080A 100%)">
      <div class="data-num">${script.number || '001'}</div>
      <div class="card-genre">${script.genre || 'General'}</div>
      <div class="card-title">${script.title || 'Untitled Script'}</div>
      <div class="card-tag">${script.tag || 'Open for collaboration'}</div>
      ${scriptMatchesUserRole(script) ? '<div class="role-match-label">Matches your role</div>' : ''}
      <div class="card-open-hint">Open Preview</div>
      <button class="request-join-btn" data-script-id="${script.id}" data-owner-id="${script.owner_id || ''}">Request</button>
    </div>
  `).join('');

  updateLiveScriptStatus(normalizedScripts.length);

  // Conditional Search Bar Visibility
  const searchWrapper = document.querySelector('.search-bar-wrapper');
  if (searchWrapper) {
    if (scripts.length < 10) {
      searchWrapper.style.display = 'none';
    } else {
      searchWrapper.style.display = 'block';
    }
  }
}

function updateDirectorMonitor(stats = {}, scripts = []) {
  const latestScript = Array.isArray(scripts) && scripts.length > 0
    ? normalizeScriptCard(scripts[0], 0)
    : null;
  const roleCounts = stats.roleCounts || {};
  const activeRoleTypes = Object.values(roleCounts).filter((count) => Number(count) > 0).length;

  updateText('monitorScripts', formatCompactNumber(stats.scripts || scripts.length));
  updateText('monitorCrew', formatCompactNumber(stats.creators));
  updateText('monitorRoles', activeRoleTypes || 0);

  if (latestScript) {
    updateText('monitorTitle', latestScript.title);
    updateText('monitorMeta', `${latestScript.genre} · ${latestScript.tag}`);
    updateText('monitorStatus', 'LIVE');
  } else {
    updateText('monitorTitle', 'Waiting for first script');
    updateText('monitorMeta', 'Upload a script to start the production signal');
    updateText('monitorStatus', 'READY');
  }
}

function updateFeatureDashboard(stats = {}, scripts = []) {
  latestHomeStats = stats;
  const latestScript = Array.isArray(scripts) ? scripts[0] : null;
  const roleCounts = stats.roleCounts || {};
  const activeRoleTypes = Object.values(roleCounts).filter((count) => Number(count) > 0).length;

  updateText('featureScriptCount', formatCompactNumber(stats.scripts));
  updateText('featureCreatorCount', formatCompactNumber(stats.creators));

  if (latestScript) {
    updateText('featureSpotlightTitle', latestScript.title || 'Untitled Script');
    updateText(
      'featureSpotlightMeta',
      `${latestScript.genre || 'General'} · ${latestScript.tag || 'Open for collaboration'}`
    );
  } else {
    updateText('featureSpotlightTitle', 'No scripts yet');
    updateText('featureSpotlightMeta', 'Upload a script to activate this');
  }

  const teamCard = document.querySelector('[data-feature-card="team"] .feat-live small');
  if (teamCard) {
    teamCard.textContent = `${activeRoleTypes || 0} role groups active`;
  }

  renderCrewRoleBrowser(roleCounts);
  updateDirectorMonitor(stats, scripts);
}

function activateFeatureSection() {
  document.querySelectorAll('[data-monitor-action]').forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.monitorAction === 'crew') {
        openCrewFinderPage();
        return;
      }

      scrollToSection('#explore');
      setTimeout(() => document.getElementById('liveSearchInput')?.focus(), 500);
    });
  });

  document.querySelectorAll('[data-feature-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const action = button.dataset.featureAction;

      if (action === 'scripts') {
        scrollToSection('#explore');
        setTimeout(() => document.getElementById('liveSearchInput')?.focus(), 500);
        showToast('Live work showcase opened ✦');
        return;
      }

      if (action === 'team') {
        openCrewFinderPage();
        showToast('Crew finder opened ✦');
        return;
      }

      if (action === 'spotlight') {
        scrollToSection('#explore');
        const firstCard = document.querySelector('#cardRow .movie-card');
        if (firstCard) {
          firstCard.classList.add('spotlight-pulse');
          setTimeout(() => firstCard.classList.remove('spotlight-pulse'), 1600);
        }
        showToast('Latest live script highlighted ✦');
      }
    });
  });

  document.querySelector('[data-feature-card="team"]')?.addEventListener('click', (event) => {
    if (event.target.closest('[data-feature-action]')) return;
    openCrewFinderPage();
    showToast('Crew finder opened ✦');
  });
}

const STAGE_COPY = {
  script: {
    title: 'Work Showcase',
    text: 'Browse live scripts, search by genre, and open script previews before requesting to join.'
  },
  crew: {
    title: 'Crew Finder',
    text: 'Open the full crew finder page to browse roles, filter people, and contact real registered users.'
  },
  request: {
    title: 'Collaboration Request',
    text: 'Send a request from any script card. TAKE ONE instantly notifies the project creator via transmission & email.'
  }
};

document.getElementById('productionStages')?.addEventListener('click', (event) => {
  const button = event.target.closest('.stage-card');
  if (!button) return;

  document.querySelectorAll('.stage-card').forEach((card) => card.classList.remove('active'));
  button.classList.add('active');

  const copy = STAGE_COPY[button.dataset.stage] || STAGE_COPY.script;
  updateText('deckPreviewTitle', copy.title);
  updateText('deckPreviewText', copy.text);

  const deckPreview = document.getElementById('deckPreview');
  if (deckPreview) {
    deckPreview.classList.remove('work-showcase-card', 'crew-finder-card', 'collaboration-card');
    if (button.dataset.stage === 'script') {
      deckPreview.classList.add('work-showcase-card');
    } else if (button.dataset.stage === 'crew') {
      deckPreview.classList.add('crew-finder-card');
    } else if (button.dataset.stage === 'request') {
      deckPreview.classList.add('collaboration-card');
    }
  }
});


async function loadHomepageData() {
  if (typeof API === 'undefined' || !API.home) return;

  const hideLoader = () => {
    const loader = document.getElementById('loader');
    if (loader) {
      loader.style.animation = 'loaderOut 0.5s ease forwards';
      setTimeout(() => { loader.style.display = 'none'; }, 500);
    }
  };

  // Safety timeout: hide loader after 5 seconds no matter what
  const safetyTimeout = setTimeout(hideLoader, 5000);

  try {
    const response = await API.home.get();
    const stats = response.stats || {};
    const roleCounts = stats.roleCounts || {};

    updateText('statCreators', formatCompactNumber(stats.creators));
    updateText('statScripts', formatCompactNumber(stats.scripts));
    updateText('statColleges', formatCompactNumber(stats.colleges));

    updateText('countDirector', roleCounts.director || 0);
    updateText('countCamera', roleCounts.camera || 0);
    updateText('countWriter', roleCounts.writer || 0);
    updateText('countSound', roleCounts.sound || 0);
    updateText('countEditor', roleCounts.editor || 0);
    updateText('countGaffer', roleCounts.gaffer || 0);
    updateText('countActor', roleCounts.actor || 0);
    updateText('countSpotBoy', roleCounts.spot_boy || 0);

    if (stats.creators && stats.colleges) {
      updateText(
        'liveCommunityText',
        `Reviewed within 24 hrs. Join ${stats.creators} creators across ${stats.colleges} colleges.`
      );
    }

    try {
      const lbRes = await fetch('/api/users/leaderboard');
      const lbJson = await lbRes.json();
      if (lbJson.success && lbJson.data) {
        const topUsers = lbJson.data.slice(0, 3);
        const row = document.getElementById('homeLeaderboardRow');
        if (row) {
          if (topUsers.length === 0) {
            row.innerHTML = `<div class="live-empty-card" style="width: 100%;">No rankings available yet.</div>`;
          } else {
            row.innerHTML = topUsers.map((user, i) => {
              const displayName = user.displayName || 'Anonymous Creator';
              const initials = displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
              const avatarHtml = user.avatar_url 
                ? `<img src="${user.avatar_url}" style="width: 48px; height: 48px; border-radius: 4px; object-fit: cover; border: 1px solid rgba(255, 77, 26, 0.3);">`
                : `<div style="width: 48px; height: 48px; border-radius: 4px; background: rgba(255, 77, 26, 0.1); color: #ff4d1a; display: flex; align-items: center; justify-content: center; font-family: 'Bebas Neue', sans-serif; font-size: 20px; border: 1px solid rgba(255, 77, 26, 0.3);">${initials}</div>`;
              
              return `
                <div class="movie-card" style="min-width: 280px; flex: 1;">
                  <div class="data-num" style="color: #ff4d1a;">#${i + 1}</div>
                  <div style="display: flex; gap: 16px; margin-bottom: 16px;">
                    ${avatarHtml}
                    <div>
                      <div style="font-family: 'Bebas Neue', sans-serif; font-size: 22px; color: #f4eee0; letter-spacing: 0.05em; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${displayName}</div>
                      <div style="font-size: 10px; color: rgba(255, 255, 255, 0.6); margin-top: 4px; text-transform: uppercase; letter-spacing: 0.1em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${user.college || 'Nexus Creator'}</div>
                    </div>
                  </div>
                  <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid rgba(255, 255, 255, 0.05); padding-top: 12px; margin-top: auto;">
                    <div style="font-size: 10px; color: rgba(255, 255, 255, 0.4); text-transform: uppercase; letter-spacing: 0.2em;">${user.role || 'Crew'}</div>
                    <div style="color: #ff4d1a; font-family: 'Space Mono', monospace; font-size: 12px; font-weight: bold;">${(user.credits || 0).toLocaleString()} PTS</div>
                  </div>
                </div>
              `;
            }).join('');
          }
        }
      }
    } catch (err) {
      console.error('Leaderboard preview error:', err);
    }
    // Fade in stats, features, and monitor slate once loaded
    if (stats.creators || stats.scripts || stats.colleges) {
      document.querySelector('.hero-stats')?.classList.add('loaded');
      document.querySelectorAll('.feat-live').forEach(el => el.classList.add('loaded'));
      document.querySelector('.monitor-slate')?.classList.add('loaded');
    }

    updateText('statusCreators', `${stats.creators || 0} Creators Active`);

    allLiveScripts = response.scripts || [];
    renderHomepageScripts(allLiveScripts);
    updateFeatureDashboard(stats, response.scripts || []);
    
    clearTimeout(safetyTimeout);
    hideLoader();
  } catch (err) {
    console.error('Homepage data load failed:', err);
    clearTimeout(safetyTimeout);
    hideLoader();
    showTransmissionLost(err.message, loadHomepageData);
  }
}


activateFeatureSection();


/* ════════════════════════════════════════════════════════════
   ADD THIS CODE TO project-2.js
   
   These are NEW functions. Add them AFTER all existing functions
   but BEFORE the final closing code.
   ════════════════════════════════════════════════════════════ */

/* ── SEARCH BAR ── */
const searchInput = document.getElementById('liveSearchInput');
const searchResults = document.getElementById('searchResults');
let searchTimeout;

searchInput?.addEventListener('input', (e) => {
  activeSearchQuery = e.target.value.trim();
  clearTimeout(searchTimeout);
  if (!activeSearchQuery) {
    if (searchResults) searchResults.style.display = 'none';
    searchTimeout = setTimeout(() => {
      loadLiveScripts();
    }, 200);
    return;
  }
  searchTimeout = setTimeout(() => {
    performSearch(activeSearchQuery);
  }, 300);
});

function renderSearchResults(scripts, query) {
  if (!searchResults) return;

  if (!query) {
    searchResults.style.display = 'none';
    return;
  }

  if (!Array.isArray(scripts) || scripts.length === 0) {
    searchResults.innerHTML = `
      <div class="search-no-results">
        No live scripts found for "<strong>${query}</strong>"
      </div>
    `;
    searchResults.style.display = 'block';
    return;
  }

  searchResults.innerHTML = scripts.slice(0, 6).map((script) => `
    <div class="search-result-item" data-script-id="${script.id}">
      <div class="sri-poster" style="background: linear-gradient(160deg, ${getCardTone(script.genre)} 0%, #06080A 100%)"></div>
      <div class="sri-info">
        <div class="sri-title">${script.title || 'Untitled Script'}</div>
        <div class="sri-genre">${script.genre || 'General'}</div>
        <div class="sri-author">by ${script.author_name || 'TAKE ONE creator'}</div>
      </div>
    </div>
  `).join('');

  searchResults.style.display = 'block';

  document.querySelectorAll('.search-result-item').forEach((item) => {
    item.addEventListener('click', () => {
      searchResults.style.display = 'none';
      scrollToSection('#explore');
      openScriptModal(item.dataset.scriptId);
    });
  });
}

async function loadLiveScripts() {
  if (typeof API === 'undefined' || !API.scripts) return;

  const genre = activeGenreFilter === 'all' ? '' : activeGenreFilter;
  updateText('liveScriptStatus', 'Loading live scripts...');

  try {
    const response = await API.scripts.search(activeSearchQuery, genre);
    allLiveScripts = response.data || [];
    renderHomepageScripts(allLiveScripts);
    renderSearchResults(allLiveScripts, activeSearchQuery);
  } catch (err) {
    console.error('Live script load failed:', err);
    updateText('liveScriptStatus', 'Could not load live scripts.');
  }
}

async function performSearch(query) {
  try {
    const genre = activeGenreFilter === 'all' ? '' : activeGenreFilter;
    const response = await API.scripts.search(query, genre);
    const scripts = response.data || [];
    allLiveScripts = scripts;
    renderHomepageScripts(scripts);
    renderSearchResults(scripts, query);
  } catch (err) {
    console.error('Search error:', err);
    if (searchResults) {
      searchResults.innerHTML = '<div class="search-no-results">Error loading results</div>';
      searchResults.style.display = 'block';
    }
  }
}

document.addEventListener('click', (e) => {
  if (!(e.target instanceof Element)) return;
  if (!e.target.closest('.search-bar-wrapper') && searchResults) {
    searchResults.style.display = 'none';
  }
});


/* ── LOGIN & REGISTER ── */
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
const scriptModalRequestBtn = document.getElementById('scriptModalRequestBtn');

/* Modal logic moved to /scripts/components/modal.js */

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

function openAuthFromUrl() {
  const authMode = new URLSearchParams(window.location.search).get('auth');
  if (authMode === 'login') openTakeOneModal(loginModal);
  if (authMode === 'register') openTakeOneModal(registerModal);
}

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
  // The final step's submit button uses .wizard-btn-next[type="submit"], not .form-submit
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

  applyRoleBasedUI(user);
  renderDynamicUploadForm(user);
}

function applyRoleBasedUI(user) {
  const creatorUploadZone = document.getElementById('creatorUploadZone');
  const crewModePanel = document.getElementById('crewModePanel');
  const uploadSectionLabel = document.getElementById('uploadSectionLabel');
  const uploadSectionTitle = document.getElementById('uploadSectionTitle');
  const uploadSectionSubtitle = document.getElementById('uploadSectionSubtitle');
  const heroSubText = document.getElementById('heroSubText');
  const heroSecondaryAction = document.getElementById('heroSecondaryAction');
  const navUploadLink = document.getElementById('navUploadLink');
  const uploadActionButton = document.getElementById('uploadActionButton');
  const guestHeroActions = document.getElementById('guestHeroActions');
  const userHeroActions = document.getElementById('userHeroActions');
  const ctaScript = document.getElementById('ctaScript');
  const workspace = getWorkspaceForRole(user?.role);

  if (!creatorUploadZone || !crewModePanel) return;

  // Setup upload action
  if (uploadActionButton) {
    uploadActionButton.onclick = uploadWork;
  }

  // Ensure the guest split CTAs (the pathway CTAs) are always displayed as the unified hero actions
  if (guestHeroActions) {
    guestHeroActions.style.display = 'flex';
  }

  if (!user) {
    if (typeof Navbar !== 'undefined') {
      Navbar.render(null);
    }
    applyRoleSkin('');
    renderRoleToolkit(null, workspace);
    creatorUploadZone.hidden = true;
    crewModePanel.hidden = false;
    if (uploadSectionLabel) uploadSectionLabel.textContent = workspace.label;
    if (uploadSectionTitle) uploadSectionTitle.textContent = workspace.title;
    if (uploadSectionSubtitle) uploadSectionSubtitle.textContent = workspace.subtitle;
    if (heroSecondaryAction) {
      heroSecondaryAction.textContent = 'Create Profile';
      heroSecondaryAction.setAttribute('href', '#');
      heroSecondaryAction.onclick = (event) => {
        event.preventDefault();
        openTakeOneModal(registerModal);
      };
    }
    if (ctaScript) {
      ctaScript.onclick = (event) => {
        event.preventDefault();
        openTakeOneModal(registerModal);
      };
    }
    applyCrewWorkspaceCopy(workspace);
    return;
  }

  const creatorMode = isCreatorRole(user.role);
  applyRoleSkin(user.role);
  renderRoleToolkit(user, workspace);

  if (typeof Navbar !== 'undefined') {
    Navbar.render(user);
  } else {
    // Legacy logic if Navbar script fails
    const nav = document.querySelector('header nav');
    let adminLink = document.getElementById('adminPanelLink');
    if (isAdmin(user)) {
      if (!adminLink && nav) {
        adminLink = document.createElement('a');
        adminLink.id = 'adminPanelLink';
        adminLink.href = 'https://admin.takeone-nexus.net.in';
        adminLink.textContent = 'Admin Panel';
        adminLink.style.color = 'var(--neon)';
        adminLink.style.fontWeight = 'bold';
        nav.insertBefore(adminLink, document.getElementById('loginBtn') || nav.lastElementChild);
      }
    } else if (adminLink) {
      adminLink.remove();
    }
    if (navUploadLink) {
      const cleanLabel = workspace.label === 'Crew' ? 'Workspace' : workspace.label;
      navUploadLink.textContent = cleanLabel;
    }
  }

  if (creatorMode) {
    creatorUploadZone.hidden = false;
    crewModePanel.hidden = true;
    if (uploadSectionLabel) uploadSectionLabel.textContent = workspace.label;
    if (uploadSectionTitle) uploadSectionTitle.textContent = workspace.title;
    if (uploadSectionSubtitle) {
      uploadSectionSubtitle.textContent = workspace.subtitle;
    }
    if (heroSubText) {
      heroSubText.textContent = `You are in ${workspace.label} mode. Your workspace is built for your role only.`;
    }
    if (heroSecondaryAction) {
      heroSecondaryAction.onclick = null;
      heroSecondaryAction.textContent = workspace.button || 'Upload Your Script';
      heroSecondaryAction.setAttribute('href', '#upload');
    }
    if (ctaScript) {
      ctaScript.onclick = (event) => {
        event.preventDefault();
        const uploadSec = document.getElementById('upload');
        if (uploadSec) {
          uploadSec.scrollIntoView({ behavior: 'smooth' });
        } else {
          window.location.hash = 'upload';
        }
      };
    }
    if (navUploadLink) {
      navUploadLink.textContent = workspace.label;
      navUploadLink.setAttribute('href', '#upload');
    }
    if (uploadActionButton) uploadActionButton.textContent = workspace.button || 'Submit Script →';
    applyCreatorWorkspaceCopy(workspace);
    return;
  }

  creatorUploadZone.hidden = true;
  crewModePanel.hidden = false;

  if (uploadSectionLabel) uploadSectionLabel.textContent = workspace.label;
  if (uploadSectionTitle) uploadSectionTitle.textContent = workspace.title;
  if (uploadSectionSubtitle) {
    uploadSectionSubtitle.textContent = workspace.subtitle;
  }
  if (heroSubText) {
    heroSubText.textContent = `You are in ${workspace.label} mode as ${user.role || 'crew'}. Only your role workspace is shown here.`;
  }
  if (heroSecondaryAction) {
    heroSecondaryAction.onclick = null;
    heroSecondaryAction.textContent = workspace.secondary || 'Build Your Crew Profile';
    heroSecondaryAction.setAttribute('href', '/profile');
  }
  if (ctaScript) {
    ctaScript.onclick = (event) => {
      event.preventDefault();
      window.location.href = '/profile';
    };
  }
  if (navUploadLink) {
    navUploadLink.textContent = workspace.label;
    navUploadLink.setAttribute('href', '#explore');
  }

  applyCrewWorkspaceCopy(workspace);
  loadLiveScripts();
}

async function checkAuthState() {
  if (typeof API === 'undefined' || !API.auth) return;
  try {
    const validation = await API.auth.validateSession();
    if (validation.valid && validation.user) {
      updateUIAfterLogin(validation.user);
      return;
    }
    applyRoleBasedUI(null);
  } catch (error) {
    console.error('Auth state validation failed:', error);
    applyRoleBasedUI(null);
  }
}

initDirectorDesk();
checkAuthState();
openAuthFromUrl();
loadHomepageData();

function renderCrewRoleBrowser(roleCounts = {}, activeQuery = '') {
  const browser = document.getElementById('crewRoleBrowser');
  if (!browser) return;

  browser.innerHTML = CREW_ROLE_OPTIONS.map((role) => {
    const count = Number(roleCounts[role.key]) || 0;
    const available = count > 0;
    const active = activeQuery && role.query.toLowerCase() === activeQuery.toLowerCase();

    return `
      <button
        type="button"
        class="crew-role-option ${available ? 'available' : 'unavailable'} ${active ? 'active' : ''}"
        data-role-query="${role.query}"
        data-role-label="${role.label}"
        data-role-count="${count}"
      >
        <div class="crew-role-icon">${role.icon}</div>
        <div class="crew-role-name">${role.label}</div>
        <div class="crew-role-status">${available ? `${count} Available` : 'Not Available'}</div>
      </button>
    `;
  }).join('');
}

function showPeopleIntro() {
  const results = document.getElementById('peopleResults');
  if (!results) return;

  results.innerHTML = `
    <div class="people-empty">
      Select any available role above to see registered people and contact them.
    </div>
  `;
}

function openCrewFinderModal() {
  const title = document.getElementById('peopleModalTitle');
  const subtitle = document.getElementById('peopleModalSubtitle');

  if (title) title.textContent = 'Crew Finder';
  if (subtitle) {
    subtitle.textContent = 'See which film roles have registered people right now. Available roles can be opened for contact details.';
  }

  renderCrewRoleBrowser(latestHomeStats.roleCounts || {});
  showPeopleIntro();

  openTakeOneModal(peopleModal);
}

function renderPeopleResults(people) {
  const results = document.getElementById('peopleResults');
  if (!results) return;

  if (!Array.isArray(people) || people.length === 0) {
    results.innerHTML = `<div class="people-empty">No registered people found for this role yet.</div>`;
    return;
  }

  results.innerHTML = people.map((person) => `
    <div class="person-card">
      <div class="person-avatar-wrap">
        <img src="${getAvatarUrl(person.name, person.gender, person.avatar_url)}" 
             class="person-avatar" 
             alt="${person.name}"
             onerror="handleImageError(this, '${person.name}', '${person.gender}')">
      </div>
      <div class="person-content">
        <div class="person-name">${person.name || 'Unnamed Creator'}</div>
        <div class="person-role">${person.role || 'Crew Member'}</div>
        <div class="person-meta">
          ${[person.city, person.college].filter(Boolean).join(' · ') || 'Location not added yet'}
        </div>
        <div class="person-bio">${person.bio || 'Profile is live. Reach out and start a conversation about the project.'}</div>
      </div>
      <div class="person-actions">
        <a class="person-contact" href="mailto:${person.email}?subject=TAKE%20ONE%20Collaboration">Email</a>
        <a class="person-chat-btn" href="/chat?userId=${encodeURIComponent(person.id)}&username=${encodeURIComponent(person.name || 'Crew Member')}&role=${encodeURIComponent(person.role || 'Crew Member')}&avatar=${encodeURIComponent(person.avatar_url || '')}">Chat</a>
        <div class="person-email">${person.email || ''}</div>
      </div>
    </div>
  `).join('');
}

function openScriptModal(scriptId) {
  const script = getNormalizedScriptById(scriptId);
  if (!script || !scriptModal) return;

  updateText('scriptModalTitle', script.title);
  updateText('scriptModalGenre', script.genre);
  updateText('scriptModalAuthor', `by ${script.author_name}`);
  updateText(
    'scriptModalSynopsis',
    script.synopsis || 'This creator has opened the project for collaboration. Use the request button to start the conversation.'
  );
  updateText('scriptModalRoles', script.tag);
  updateText('scriptModalStatus', script.status || 'Live');

  const poster = document.getElementById('scriptModalPoster');
  if (poster) {
    poster.style.background = `
      radial-gradient(circle at 50% 30%, rgba(255, 77, 26, 0.22), transparent 42%),
      linear-gradient(160deg, ${getCardTone(script.genre)} 0%, #06080A 100%)
    `;
  }

  if (scriptModalRequestBtn) {
    scriptModalRequestBtn.dataset.scriptId = script.id;
    scriptModalRequestBtn.dataset.ownerId = script.owner_id || '';
    scriptModalRequestBtn.disabled = false;
    scriptModalRequestBtn.textContent = 'Request To Join →';
  }

  openTakeOneModal(scriptModal);
}

async function openPeopleModal(roleQuery, roleLabel) {
  const title = document.getElementById('peopleModalTitle');
  const subtitle = document.getElementById('peopleModalSubtitle');
  const results = document.getElementById('peopleResults');
  const role = CREW_ROLE_OPTIONS.find((item) => item.query.toLowerCase() === String(roleQuery || '').toLowerCase());
  const count = Number((latestHomeStats.roleCounts || {})[role?.key]) || 0;

  renderCrewRoleBrowser(latestHomeStats.roleCounts || {}, roleQuery);

  if (title) title.textContent = 'Crew Finder';
  if (subtitle) subtitle.textContent = `Showing registered ${roleLabel?.toLowerCase() || 'crew members'} you can contact.`;

  if (count === 0 && role) {
    if (results) {
      results.innerHTML = `<div class="people-empty">${roleLabel || 'This role'} is not available yet. When someone registers for this role, they will appear here.</div>`;
    }
    openTakeOneModal(peopleModal);
    return;
  }

  if (results) results.innerHTML = '<div class="people-empty">Loading people...</div>';
  openTakeOneModal(peopleModal);

  try {
    const response = await API.users.search({ role: roleQuery });
    renderPeopleResults(response.data || []);
  } catch (err) {
    if (results) {
      results.innerHTML = `<div class="people-empty">Could not load people right now.</div>`;
    }
  }
}

document.querySelectorAll('.role-card').forEach((card) => {
  card.addEventListener('click', () => {
    openCrewFinderPage(card.dataset.roleQuery);
  });
});

document.querySelectorAll('[data-open-crew-finder]').forEach((link) => {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    openCrewFinderPage();
  });
});

document.getElementById('crewRoleBrowser')?.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('.crew-role-option');
  if (!button) return;

  openPeopleModal(button.dataset.roleQuery, button.dataset.roleLabel);
});

async function requestToJoinScript(scriptId, ownerId, button) {
  if (!API.auth.isLoggedIn()) {
    showToast('❌ Please login to request a role');
    document.getElementById('loginBtn').click();
    return false;
  }

  const user = API.auth.getUser();

  if (Number(ownerId) === Number(user.id)) {
    showToast('❌ This is your own script');
    return false;
  }

  try {
    const response = await API.requests.create({
      script_id: Number(scriptId),
      message: `${user.name} wants to join as ${user.role || 'crew'}`
    });
    showToast(response.data?.email_sent ? 'Request sent and email delivered ✦' : 'Request saved. Email setup needed ✦');
    if (button) {
      button.textContent = 'Sent';
      button.disabled = true;
    }
    return true;
  } catch (err) {
    showToast(`❌ ${err.message || 'Could not send request'}`);
    return false;
  }
}

document.getElementById('cardRow')?.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  const btn = event.target.closest('.request-join-btn');
  const card = event.target.closest('.movie-card');

  if (btn) {
    event.stopPropagation();
    await requestToJoinScript(btn.dataset.scriptId, btn.dataset.ownerId, btn);
    return;
  }

  if (card) {
    openScriptModal(card.dataset.scriptId);
  }
});

document.getElementById('cardRow')?.addEventListener('mousemove', (event) => {
  if (!(event.target instanceof Element)) return;
  const card = event.target.closest('.movie-card');
  if (!card) return;

  const rect = card.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const rotateY = ((x / rect.width) - 0.5) * 10;
  const rotateX = ((0.5 - (y / rect.height)) * 10);

  card.style.transform = `perspective(700px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
});

document.getElementById('cardRow')?.addEventListener('mouseleave', () => {
  document.querySelectorAll('.movie-card').forEach((card) => {
    card.style.transform = '';
  });
});

scriptModalRequestBtn?.addEventListener('click', async () => {
  const sent = await requestToJoinScript(
    scriptModalRequestBtn.dataset.scriptId,
    scriptModalRequestBtn.dataset.ownerId,
    scriptModalRequestBtn
  );

  if (sent && scriptModal) {
    setTimeout(() => {
      closeTakeOneModal(scriptModal);
    }, 600);
  }
});


/* ── UPDATE UPLOAD FUNCTION ── */
/* REPLACE THE EXISTING uploadScript() FUNCTION WITH THIS: */

function uploadScript() {
  if (!API.auth.isLoggedIn()) {
    showToast('❌ Please login to upload a script');
    document.getElementById('loginBtn').click();
    return;
  }
  
  const titleEl = document.getElementById('scriptTitle');
  const genreEl = document.getElementById('scriptTheme');
  const descEl = document.getElementById('scriptDesc');
  const posterEl = document.getElementById('posterInput');
  const authorEl = document.getElementById('authorName');
  
  const title = titleEl.value.trim();
  const genre = genreEl.value;
  const synopsis = descEl.value.trim();
  const authorAlias = authorEl?.value.trim();
  
  if (!title) {
    showToast('Please enter a title ✦');
    return;
  }

  const user = API.auth.getUser();
  const workspace = getWorkspaceForRole(user.role);

  if (!isCreatorRole(user.role)) {
    showToast('❌ Crew roles cannot upload scripts. Browse projects or build your profile.');
    return;
  }

  const uploadBtn = document.getElementById('uploadActionButton');
  const originalText = uploadBtn.textContent;

  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Submitting...';

  API.scripts.create({
    title,
    genre,
    synopsis,
    roles_needed: authorAlias || workspace.rolesPlaceholder || `${user.role || 'Creator'} needed`,
    status: workspace.status || 'Just Added'
  }).then((response) => {
    showToast('Script submitted ✦');
    loadHomepageData();

    titleEl.value = '';
    descEl.value = '';
    posterEl.value = '';
    if (authorEl) authorEl.value = '';
  }).catch((err) => {
    showToast(`❌ ${err.message || 'Could not upload script'}`);
  }).finally(() => {
    uploadBtn.disabled = false;
    uploadBtn.textContent = originalText;
  });
}

/* ── LOCATION AUTOCOMPLETE ── */
function initLocationAutocomplete() {
  const cityInput = document.getElementById('registerCity');
  const suggestionsBox = document.getElementById('citySuggestions');
  if (!cityInput || !suggestionsBox) return;

  let selectedIndex = -1;

  cityInput.addEventListener('input', () => {
    const query = cityInput.value.toLowerCase().trim();
    if (!query) {
      suggestionsBox.innerHTML = '';
      suggestionsBox.classList.remove('active');
      return;
    }

    const matches = (window.INDIAN_CITIES || []).filter(city => 
      city.toLowerCase().includes(query)
    ).slice(0, 10);

    if (matches.length > 0) {
      suggestionsBox.innerHTML = matches.map((city, index) => `
        <div class="suggestion-item" data-index="${index}">${city}</div>
      `).join('');
      suggestionsBox.classList.add('active');
    } else {
      suggestionsBox.innerHTML = '';
      suggestionsBox.classList.remove('active');
    }
    selectedIndex = -1;
  });

  cityInput.addEventListener('keydown', (e) => {
    const items = suggestionsBox.querySelectorAll('.suggestion-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection(items);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection(items);
      e.preventDefault();
    } else if (e.key === 'Enter' && selectedIndex > -1) {
      selectCity(items[selectedIndex].textContent);
      e.preventDefault();
    }
  });

  function updateSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === selectedIndex);
    });
  }

  function selectCity(city) {
    cityInput.value = city;
    suggestionsBox.innerHTML = '';
    suggestionsBox.classList.remove('active');
  }

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (item) {
      selectCity(item.textContent);
    }
  });

  document.addEventListener('click', (e) => {
    if (!cityInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.remove('active');
    }
  });
}

function initCollegeAutocomplete() {
  const collegeInput = document.getElementById('registerCollege');
  const suggestionsBox = document.getElementById('collegeSuggestions');
  if (!collegeInput || !suggestionsBox) return;

  let selectedIndex = -1;

  collegeInput.addEventListener('input', () => {
    const query = collegeInput.value.toLowerCase().trim();
    if (!query) {
      suggestionsBox.innerHTML = '';
      suggestionsBox.classList.remove('active');
      return;
    }

    const matches = (window.INDIAN_COLLEGES || []).filter(college => 
      college.toLowerCase().includes(query)
    ).slice(0, 10);

    if (matches.length > 0) {
      suggestionsBox.innerHTML = matches.map((college, index) => `
        <div class="suggestion-item" data-index="${index}">${college}</div>
      `).join('');
      suggestionsBox.classList.add('active');
    } else {
      suggestionsBox.innerHTML = '';
      suggestionsBox.classList.remove('active');
    }
    selectedIndex = -1;
  });

  collegeInput.addEventListener('keydown', (e) => {
    const items = suggestionsBox.querySelectorAll('.suggestion-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      selectedIndex = (selectedIndex + 1) % items.length;
      updateSelection(items);
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      updateSelection(items);
      e.preventDefault();
    } else if (e.key === 'Enter' && selectedIndex > -1) {
      selectCollege(items[selectedIndex].textContent);
      e.preventDefault();
    }
  });

  function updateSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === selectedIndex);
    });
  }

  function selectCollege(college) {
    collegeInput.value = college;
    suggestionsBox.innerHTML = '';
    suggestionsBox.classList.remove('active');
  }

  suggestionsBox.addEventListener('click', (e) => {
    const item = e.target.closest('.suggestion-item');
    if (item) {
      selectCollege(item.textContent);
    }
  });

  document.addEventListener('click', (e) => {
    if (!collegeInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
      suggestionsBox.classList.remove('active');
    }
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initLocationAutocomplete();
    initCollegeAutocomplete();
  });
} else {
  initLocationAutocomplete();
  initCollegeAutocomplete();
}
