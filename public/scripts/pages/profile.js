let isOwner = false;

/* Logic moved to common.js and ui.js */

/* ── TAB SWITCHING ── */
function switchTab(name, btn) {
    /* Hide all panes, deactivate all tabs */
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.ctab').forEach(b => b.classList.remove('active'));

    /* Activate the selected pane */
    const targetPane = document.getElementById('tab-' + name);
    if (targetPane) {
        targetPane.classList.add('active');
    }

    /* Activate the correct button */
    if (btn) {
        btn.classList.add('active');
    } else {
        /* Called without a button reference (e.g. from "Edit Profile" link) */
        document.querySelectorAll('.ctab').forEach(b => {
            if (b.getAttribute('data-tab') === name) {
                b.classList.add('active');
            }
        });
    }
}

function activateHashTab() {
    const requestedTab = window.location.hash.replace('#', '');
    const allowedTabs = ['projects', 'about', 'collab', 'notifications'];

    if (allowedTabs.includes(requestedTab)) {
        switchTab(requestedTab);
    }
}

/* ── AVATAR UPLOAD ── */
async function changeAvatar(input) {
    if (!input.files[0]) return;
    const file = input.files[0];

    // 1. Show immediate local visual feedback (optimistic UI design)
    const reader = new FileReader();
    reader.onload = e => {
        document.getElementById('profilePic').src = e.target.result;
    };
    reader.readAsDataURL(file);

    // 2. Wrap file in FormData and upload permanently to your server
    const formData = new FormData();
    formData.append('avatar', file);

    try {
        if (typeof showToast === 'function') showToast('Uploading picture... ✦');
        
        const response = await fetch('/api/users/upload-avatar', {
            method: 'POST',
            body: formData,
             credentials: 'include',  // ← Add this
    headers: {
        'Authorization': `Bearer ${API.auth.getToken()}`  // ← Add this
    }
            // (Note: If your API uses Bearer JWT headers, be sure to add 'Authorization': 'Bearer <token>' here)
        });
        
        const result = await response.json();
        
        if (result.success) {
            if (typeof showToast === 'function') showToast('Profile picture saved permanently! ✦');
            
            // Update the preview image with the server's permanent URL
            const picEl = document.getElementById('profilePic');
            if (picEl) picEl.src = result.avatar_url;
            if (currentProfileData) {
                currentProfileData.avatar_url = result.avatar_url;
            }

            // 3. Keep client-session in sync
            if (typeof API !== 'undefined' && API.auth) {
                const user = API.auth.getUser();
                if (user) {
                    user.avatar_url = result.avatar_url;
                    API.auth.saveToken(API.auth.getToken(), user); // Save back to local storage
                }
            }
        } else {
            if (typeof showToast === 'function') showToast(result.message || 'Upload failed ✦');
        }
    } catch (err) {
        console.error('Upload failed:', err);
        if (typeof showToast === 'function') showToast('Error linking picture to server. ✦');
    }
}

/* ── LIVE NAME PREVIEW ── */
function liveUpdateName(val) {
    const el = document.getElementById('profileName');
    if (val.trim()) el.textContent = val;
}

function renderSkillBadges(skills) {
    const wrap = document.getElementById('skillBadges');
    if (!wrap) return;

    if (typeof splitSkills !== 'function') return;
    const items = splitSkills(skills);
    if (items.length === 0) {
        wrap.innerHTML = '<span class="badge">New Creator</span>';
        if (typeof updateStat === 'function') updateStat('skillsCount', 0);
        return;
    }

    wrap.innerHTML = items.map(skill => `<span class="badge">${skill}</span>`).join('');
    if (typeof updateStat === 'function') updateStat('skillsCount', items.length);
}

function setProfileGate(show) {
    const gate = document.getElementById('profileAuthGate');
    const main = document.querySelector('.profile-main');
    const logout = document.getElementById('profileLogoutBtn');

    if (gate) gate.hidden = !show;
    if (main) main.hidden = show;
    if (logout) logout.hidden = show;
}

function renderProjects(scripts) {
    const grid = document.getElementById('projectGrid');
    if (!grid) return;

    const items = Array.isArray(scripts) ? scripts : [];
    
    // Check if getCardTone is available
    const getTone = (typeof getCardTone === 'function') ? getCardTone : () => '#1C2330';

    const cards = items.map((script, index) => `
        <div class="project-card"
             style="background: linear-gradient(160deg, ${getTone(script.genre)} 0%, #06080A 100%)">
          <div class="pc-num">${String(index + 1).padStart(3, '0')}</div>
          <div class="pc-genre">${script.genre || 'General'}</div>
          <div class="pc-title">${script.title || 'Untitled Script'}</div>
        </div>
    `).join('');

    grid.innerHTML = cards + (isOwner ? `
        <div class="project-card"
             style="background: rgba(255,77,26,0.03);
                    border: 1px dashed rgba(255,77,26,0.2);
                    display: flex; flex-direction: column;
                    align-items: center; justify-content: center;
                    cursor: pointer;"
             onclick="openEditWorkModal()">
          <div style="font-size: 28px; color: rgba(255,77,26,0.3); margin-bottom: 8px;">+</div>
          <div style="font-size: 8px; letter-spacing: 0.3em; text-transform: uppercase;
                      color: rgba(255,77,26,0.4);">Add Work</div>
        </div>
    ` : (items.length === 0 ? `
        <div class="project-card"
             style="background: rgba(255,77,26,0.03); border: 1px dashed rgba(255,77,26,0.2); display: flex; flex-direction: column; align-items: center; justify-content: center;">
          <div style="font-size: 12px; color: rgba(255,77,26,0.5); text-transform: uppercase; letter-spacing: 0.2em;">No scripts yet</div>
        </div>` : ''));

    if (typeof updateStat === 'function') updateStat('projCount', items.length);
}

function renderPortfolio(profile) {
    const detailsWrap = document.getElementById('portfolioRoleDetails');
    const gridWrap = document.getElementById('portfolioGrid');
    if (!detailsWrap || !gridWrap) return;

    const role = profile.role || 'Other';
    const scripts = profile.scripts || [];
    
    // 1. Render Role-Specific Details Cards
    let detailsHtml = '';
    const socialLinks = profile.social_links || '';
    
    if (role.includes('Director')) {
        detailsHtml = `
            <div class="portfolio-card-mini">
                <strong>Director's Vision</strong>
                <p>${profile.bio ? profile.bio.substring(0, 100) + '...' : 'Building a vision...'}</p>
            </div>
            <div class="portfolio-card-mini">
                <strong>Socials</strong>
                <p>${socialLinks || 'No links added'}</p>
            </div>
        `;
    } else if (role.includes('Cinematographer') || role.includes('DP')) {
         detailsHtml = `
            <div class="portfolio-card-mini">
                <strong>Camera Gear</strong>
                <p>${profile.skills || 'Add gear to skills'}</p>
            </div>
            <div class="portfolio-card-mini">
                <strong>Showreel</strong>
                <p><a href="${profile.portfolio || '#'}" target="_blank">View Reel →</a></p>
            </div>
        `;
    } else {
        detailsHtml = `
            <div class="portfolio-card-mini">
                <strong>Creator Stats</strong>
                <p>${scripts.length} Projects · ${profile.credits} Credits</p>
            </div>
            <div class="portfolio-card-mini">
                <strong>Bio</strong>
                <p>${profile.bio ? profile.bio.substring(0, 60) + '...' : 'New Creator'}</p>
            </div>
        `;
    }
    
    detailsWrap.innerHTML = detailsHtml;

    const authUser = API.auth.getUser();
    isOwner = !!(authUser && profile.id === authUser.id);

    // 2. Render Featured Work Cards
    if (scripts.length === 0) {
        gridWrap.innerHTML = `
            <div class="collab-empty">
                <p>No projects uploaded to showcase yet.</p>
                ${isOwner ? '<button onclick="openEditWorkModal()" class="btn-sm">Add Work →</button>' : ''}
            </div>
        `;
    } else {
        gridWrap.innerHTML = scripts.map((script, i) => {
            let roleInfo = '';
            if (script.role_data) {
                try {
                    const rData = JSON.parse(script.role_data);
                    roleInfo = Object.entries(rData)
                        .filter(([k, v]) => v)
                        .map(([k, v]) => `<div class="pi-role-tag"><strong>${k}:</strong> ${v}</div>`)
                        .join('');
                } catch(e) {}
            }

            return `
                <div class="portfolio-item-card">
                    <div class="pi-header">
                        <span class="pi-type">${script.work_type || 'Project'}</span>
                        <span class="pi-num">0${i+1}</span>
                        ${isOwner ? `
                            <div class="pi-owner-actions">
                                <button onclick="openEditWorkModal(${script.id})" class="pi-btn">✎</button>
                                <button onclick="deleteWork(${script.id})" class="pi-btn">×</button>
                            </div>
                        ` : ''}
                    </div>
                    <div class="pi-title">${script.title}</div>
                    <div class="pi-meta">${script.genre || 'General'} · ${script.status || 'Active'}</div>
                    <div class="pi-role-data">${roleInfo}</div>
                    ${script.media_links ? `<a href="${script.media_links}" target="_blank" class="pi-link">View Project →</a>` : ''}
                </div>
            `;
        }).join('');
    }
}

let currentProfileData = null;

function populateProfile(profile) {
    if (!profile) return;
    currentProfileData = profile;
    
    const nameEl = document.getElementById('profileName');
    if (nameEl) {
        if (typeof UserUtils !== 'undefined') {
            nameEl.textContent = UserUtils.getDisplayName(profile);
        } else {
            nameEl.textContent = profile.name || 'Creator Name';
        }
    }
    
    const roleEl = document.getElementById('profileRole');
    if (roleEl) {
        roleEl.textContent = profile.role || 'Independent Filmmaker';
    }

    const metaEl = document.getElementById('profileMeta');
    if (metaEl) {
        metaEl.textContent = [profile.college || 'College', profile.city || 'City']
            .filter(Boolean)
            .join(' · ');
    }

    const bioEl = document.getElementById('profileBio');
    if (bioEl) {
        bioEl.textContent = profile.bio || 'No bio provided yet.';
    }

    if (profile.avatar_url) {
        const picEl = document.getElementById('profilePic');
        if (picEl) picEl.src = profile.avatar_url;
    }

    if (document.getElementById('editName')) document.getElementById('editName').value = profile.name || '';
    if (document.getElementById('editRole')) document.getElementById('editRole').value = profile.role || '';
    if (document.getElementById('editCollege')) document.getElementById('editCollege').value = profile.college || '';
    if (document.getElementById('editCity')) document.getElementById('editCity').value = profile.city || '';
    if (document.getElementById('editPortfolio')) document.getElementById('editPortfolio').value = profile.portfolio || '';
    if (document.getElementById('editBio')) document.getElementById('editBio').value = profile.bio || '';
    if (document.getElementById('editSkills')) document.getElementById('editSkills').value = profile.skills || '';
    if (document.getElementById('editScreenName')) document.getElementById('editScreenName').value = profile.screen_name || '';
    if (document.getElementById('editDisplayPreference')) document.getElementById('editDisplayPreference').value = profile.display_preference || 'Show Real Name Only';
    if (document.getElementById('editSocialLinks')) document.getElementById('editSocialLinks').value = profile.social_links || '';
    if (document.getElementById('editAvailability')) document.getElementById('editAvailability').value = profile.availability || 'Available';

    renderSkillBadges(profile.skills);
    renderProjects(profile.scripts || []);
    renderPortfolio(profile);

    if (typeof updateStat === 'function') updateStat('profileCity', profile.city || '--');
}

async function loadProfile() {
    if (typeof API === 'undefined' || !API.auth || !API.users) return;

    const urlParams = new URLSearchParams(window.location.search);
    const targetId = urlParams.get('id');
    const authUser = API.auth.getUser();
    
    // If we have a targetId and it's not us, fetch public profile
    if (targetId && (!authUser || authUser.id !== parseInt(targetId))) {
        isOwner = false;
        try {
            const res = await fetch(`/api/users/public/${targetId}`);
            const json = await res.json();
            if (json.success) {
                populateProfile(json.data);
                // Hide edit elements if not owner
                document.querySelectorAll('.avatar-edit, .btn-edit-profile, .btn-sm, #sidebarEditBtn').forEach(el => {
                    if (el.id !== 'messageBtn') el.style.display = 'none';
                });
                return;
            }
        } catch (err) {
            console.error('Error loading public profile:', err);
        }
    }

    // Default to own profile
    if (!authUser || !authUser.id) {
        setProfileGate(true);
        return;
    }

    isOwner = true;
    try {
        setProfileGate(false);
        const response = await API.users.getProfile(authUser.id);
        if (response.success && response.data) {
            populateProfile(response.data);
            loadCollaborationRequests(authUser.id);
            loadNotifications(authUser.id);
        }
    } catch (err) {
        console.error('Profile load failed:', err);
        if (typeof showToast === 'function') showToast(`Could not load profile ✦`);
    }
}

function requestCard(request, mode) {
    const otherName = mode === 'incoming'
        ? request.requester_name
        : request.owner_name;
    const otherGender = mode === 'incoming'
        ? request.requester_gender
        : request.owner_gender;
    const otherAvatar = mode === 'incoming'
        ? request.requester_avatar_url
        : request.owner_avatar_url;

    const roleLine = mode === 'incoming'
        ? `${request.requester_role || 'Crew'}${request.requester_city ? ' · ' + request.requester_city : ''}`
        : 'Project owner';
    const status = String(request.status || 'pending').toLowerCase();
    
    // Check if escapeHTML is available
    const esc = (typeof escapeHTML === 'function') ? escapeHTML : (t) => t;

    const statusPill = `<div class="request-status ${esc(status)}">${esc(status)}</div>`;
    const decisionActions = mode === 'incoming' && status === 'pending'
        ? `
            <div class="request-actions">
                <button class="request-action accept" type="button"
                        onclick="updateRequestStatus(${Number(request.id)}, 'accepted', this)">Accept</button>
                <button class="request-action reject" type="button"
                        onclick="updateRequestStatus(${Number(request.id)}, 'rejected', this)">Reject</button>
            </div>
        `
        : '';
    const contactLink = `
        <div class="request-actions-row">
            <a class="request-chat-btn" href="/chat?userId=${request.requester_id || request.owner_id}">Open Chat</a>
        </div>
    `;

    return `
        <div class="request-card">
            <div class="request-avatar-wrap">
                <img src="${getAvatarUrl(otherName, otherGender || 'Other', otherAvatar)}" 
                     class="request-avatar" 
                     alt="${esc(otherName)}"
                     onerror="handleImageError(this, '${esc(otherName)}', '${otherGender || 'Other'}')">
            </div>
            <div class="request-main">
                <div class="request-script">${esc(request.script_title || 'Untitled Script')}</div>
                <div class="request-meta">${esc(request.script_genre || 'General')}</div>
                <div class="request-person">${esc(otherName || 'Creator')} · ${esc(roleLine)}</div>
                <div class="request-message">${esc(request.message || 'No message added.')}</div>
            </div>
            <div class="request-side">
                ${statusPill}
                ${decisionActions}
                ${contactLink}
            </div>
        </div>
    `;
}

function renderRequestList(id, requests, mode) {
    const el = document.getElementById(id);
    if (!el) return;

    if (!Array.isArray(requests) || requests.length === 0) {
        el.innerHTML = `
            <div class="collab-empty">
                <div class="collab-reel"><span>🎬</span></div>
                <p>${mode === 'incoming' ? 'No incoming requests yet' : 'No sent requests yet'}</p>
                <em>${mode === 'incoming' ? 'Crew requests for your scripts will appear here.' : 'Requests you send to productions will appear here.'}</em>
            </div>
        `;
        return;
    }

    el.innerHTML = requests.map(request => requestCard(request, mode)).join('');
}

async function updateRequestStatus(requestId, status, button) {
    if (typeof API === 'undefined' || !API.requests) return;

    const authUser = API.auth.getUser();
    if (!authUser || !authUser.id) return;

    const card = button?.closest('.request-card');
    const buttons = card ? card.querySelectorAll('button') : [];

    try {
        buttons.forEach(item => item.disabled = true);
        await API.requests.updateStatus(requestId, status);
        if (typeof showToast === 'function') showToast(`Request ${status} ✦`);
        loadCollaborationRequests(authUser.id);
        loadNotifications(authUser.id);
    } catch (err) {
        console.error('Request status update failed:', err);
        if (typeof showToast === 'function') showToast(err.message || 'Could not update request ✦');
        buttons.forEach(item => item.disabled = false);
    }
}

async function loadCollaborationRequests(userId) {
    if (typeof API === 'undefined' || !API.requests) return;

    try {
        const response = await API.requests.forUser(userId);
        const data = response.data || {};
        renderRequestList('incomingRequests', data.incoming || [], 'incoming');
        renderRequestList('outgoingRequests', data.outgoing || [], 'outgoing');
    } catch (err) {
        console.error('Request load failed:', err);
    }
}

function formatNotificationTime(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';

    return date.toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function notificationCard(notification) {
    const unread = Number(notification.is_read) === 0;
    const esc = (typeof escapeHTML === 'function') ? escapeHTML : (t) => t;

    const openAction = notification.link_url
        ? `<a class="notification-read" href="${esc(notification.link_url)}">Open</a>`
        : '';
    const readAction = unread
        ? `<button class="notification-read" type="button"
                   onclick="markNotificationRead(${Number(notification.id)}, this)">Mark Read</button>`
        : `<button class="notification-read" type="button" disabled>Read</button>`;

    return `
        <div class="notification-card ${unread ? 'unread' : ''}">
            <div>
                <div class="notification-title">${esc(notification.title || 'Notification')}</div>
                <div class="notification-body">${esc(notification.body || '')}</div>
                <div class="notification-time">${esc(formatNotificationTime(notification.created_at))}</div>
            </div>
            <div class="notification-side">
                ${openAction}
                ${readAction}
            </div>
        </div>
    `;
}

function renderNotifications(notifications, unreadCount) {
    const list = document.getElementById('notificationList');
    const count = document.getElementById('notificationCount');
    if (count) count.textContent = unreadCount || 0;
    if (!list) return;

    const items = Array.isArray(notifications) ? notifications : [];

    if (items.length === 0) {
        list.innerHTML = `
            <div class="collab-empty">
                <div class="collab-reel"><span>•</span></div>
                <p>No notifications yet</p>
                <em>Collaboration updates will appear here.</em>
            </div>
        `;
        return;
    }

    list.innerHTML = items.map(notificationCard).join('');
}

async function loadNotifications(userId) {
    if (typeof API === 'undefined' || !API.notifications) return;

    try {
        const response = await API.notifications.forUser(userId);
        renderNotifications(response.data || [], response.unread_count || 0);
    } catch (err) {
        console.error('Notification load failed:', err);
    }
}

async function markNotificationRead(notificationId, button) {
    const authUser = API.auth.getUser();
    if (!authUser || !authUser.id) return;

    try {
        if (button) button.disabled = true;
        await API.notifications.markRead(notificationId);
        loadNotifications(authUser.id);
    } catch (err) {
        console.error('Notification read failed:', err);
        if (typeof showToast === 'function') showToast(err.message || 'Could not update notification ✦');
        if (button) button.disabled = false;
    }
}

async function markAllNotificationsRead() {
    const authUser = API.auth.getUser();
    if (!authUser || !authUser.id) return;

    try {
        await API.notifications.markAllRead(authUser.id);
        loadNotifications(authUser.id);
        if (typeof showToast === 'function') showToast('Notifications cleared ✦');
    } catch (err) {
        console.error('Notification clear failed:', err);
        if (typeof showToast === 'function') showToast(err.message || 'Could not clear notifications ✦');
    }
}

/* ── SAVE PROFILE ── */
async function saveProfile() {
    if (typeof API === 'undefined' || !API.auth || !API.users) return;

    const authUser = API.auth.getUser();
    if (!authUser || !authUser.id) return;

    const saveButton = document.querySelector('.save-btn') || document.getElementById('saveProfileBtn');
    const originalText = saveButton ? saveButton.textContent : '';
    
    let avatarUrl = document.getElementById('profilePic')?.src || '';
    if (avatarUrl.startsWith('data:')) {
        avatarUrl = currentProfileData?.avatar_url || '';
    }

    const payload = {
        name: document.getElementById('editName')?.value.trim() || '',
        avatar_url: avatarUrl,
        role: document.getElementById('editRole')?.value.trim() || '',
        college: document.getElementById('editCollege')?.value.trim() || '',
        city: document.getElementById('editCity')?.value.trim() || '',
        gender: document.getElementById('editGender')?.value || 'Prefer not to say',
        portfolio: document.getElementById('editPortfolio')?.value.trim() || '',
        bio: document.getElementById('editBio')?.value.trim() || '',
        skills: document.getElementById('editSkills')?.value.trim() || '',
        screen_name: document.getElementById('editScreenName')?.value.trim() || '',
        display_preference: document.getElementById('editDisplayPreference')?.value || 'Show Real Name Only',
        social_links: document.getElementById('editSocialLinks')?.value.trim() || '',
        availability: document.getElementById('editAvailability')?.value || 'Available'
    };

    if (!payload.name) {
        if (typeof showToast === 'function') showToast('Name is required ✦');
        return;
    }

    try {
        if (saveButton) {
            saveButton.disabled = true;
            saveButton.textContent = 'Saving...';
        }

        const response = await API.users.updateProfile(authUser.id, payload);
        if (response.success && response.data) {
            populateProfile(response.data);
            API.auth.saveToken(API.auth.getToken(), {
                id: response.data.id,
                name: response.data.name,
                role: response.data.role || '',
                college: response.data.college || '',
                city: response.data.city || '',
                gender: response.data.gender || 'Prefer not to say',
                availability: response.data.availability || 'Available'
            });
            if (typeof showToast === 'function') showToast('Profile saved permanently ✦');
        }
    } catch (err) {
        console.error('Profile save failed:', err);
        if (typeof showToast === 'function') showToast(err.message || 'Could not save profile ✦');
    } finally {
        if (saveButton) {
            saveButton.disabled = false;
            saveButton.textContent = originalText || 'Save Changes →';
        }
    }
}

/* Initialization */
function initProfile() {


    /* Avatar Edit */
    const avatarBtn = document.getElementById('avatarEditBtn');
    const avatarInput = document.getElementById('avatarInput');
    if (avatarBtn && avatarInput) {
        avatarBtn.addEventListener('click', () => avatarInput.click());
        avatarInput.addEventListener('change', (e) => changeAvatar(e.target));
    }

    /* Sidebar Edit Button -> Switch to About Tab */
    const sidebarEditBtn = document.getElementById('sidebarEditBtn');
    if (sidebarEditBtn) {
        sidebarEditBtn.addEventListener('click', () => {
            const aboutTabBtn = document.querySelector('.ctab[data-tab="about"]');
            switchTab('about', aboutTabBtn);
            document.getElementById('profileTabs')?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    /* Tab Switching */
    document.querySelectorAll('.ctab').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.getAttribute('data-tab');
            switchTab(tabName, btn);
        });
    });

    /* Save Profile */
    const saveBtn = document.getElementById('saveProfileBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            saveProfile();
        });
    }

    /* Notifications */
    const markReadBtn = document.getElementById('markReadBtn');
    if (markReadBtn) {
        markReadBtn.addEventListener('click', markAllNotificationsRead);
    }

    /* Project Add -> Now opens modal */
    const addProj = document.getElementById('addProjectAction');
    if (addProj) {
        addProj.addEventListener('click', () => {
            openEditWorkModal();
        });
    }

    /* Modal Close */
    const closeBtn = document.getElementById('closeWorkModal');
    if (closeBtn) closeBtn.onclick = closeWorkModal;
    
    const modal = document.getElementById('workModal');
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) closeWorkModal();
        };
    }
    
    /* Form Submit */
    const workForm = document.getElementById('workForm');
    if (workForm) workForm.onsubmit = handleWorkSubmit;

    /* Logout */
    const logoutBtn = document.getElementById('profileLogoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            if (typeof API !== 'undefined' && API.auth) {
                API.auth.logout();
                window.location.href = '/';
            }
        });
    }

    /* Initial Load */
    loadProfile().then(activateHashTab);
}

/* Handle Next.js hydration / Script load timing */
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initProfile();
} else {
    window.addEventListener('DOMContentLoaded', initProfile);
}

window.addEventListener('hashchange', activateHashTab);

// ── ROLE-BASED FIELDS CONFIGURATION ──
const ROLE_FIELDS = {
    'DIRECTOR': [
        { id: 'teamNeeded', label: 'Team Needed', type: 'text', placeholder: 'e.g. Editor, DP, 2 Actors' },
    ],
    'EDITOR': [
        { id: 'software', label: 'Editing Software', type: 'text', placeholder: 'e.g. Premiere Pro, DaVinci Resolve' },
        { id: 'editType', label: 'Edit Description', type: 'textarea', placeholder: 'Briefly describe the edit style...' }
    ],
    'ACTOR': [
        { id: 'characterRole', label: 'Role Played', type: 'text', placeholder: 'e.g. Lead, Antagonist' },
    ],
    'DESIGNER': [
        { id: 'designTools', label: 'Tools Used', type: 'text', placeholder: 'e.g. Photoshop, Illustrator, Blender' },
        { id: 'designType', label: 'Design Specialization', type: 'text', placeholder: 'e.g. Poster Design, UI/UX' }
    ],
    'CINEMATOGRAPHER': [
        { id: 'cameraUsed', label: 'Camera Gear', type: 'text', placeholder: 'e.g. RED Komodo, Sony A7SIII' },
        { id: 'visualStyle', label: 'Visual Style', type: 'text', placeholder: 'e.g. High Contrast, Anamorphic' }
    ],
    'DP': [
        { id: 'cameraUsed', label: 'Camera Gear', type: 'text', placeholder: 'e.g. RED Komodo, Sony A7SIII' },
        { id: 'visualStyle', label: 'Visual Style', type: 'text', placeholder: 'e.g. High Contrast, Anamorphic' }
    ]
};

function injectRoleFields(role, existingData = {}) {
    const container = document.getElementById('roleDynamicFields');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Normalize role name
    let normalizedRole = 'OTHER';
    for (const r in ROLE_FIELDS) {
        if (role.toUpperCase().includes(r)) {
            normalizedRole = r;
            break;
        }
    }
    
    const fields = ROLE_FIELDS[normalizedRole] || [];
    
    fields.forEach(field => {
        const group = document.createElement('div');
        group.className = 'form-group';
        
        const label = document.createElement('label');
        label.textContent = field.label;
        
        let input;
        if (field.type === 'textarea') {
            input = document.createElement('textarea');
        } else {
            input = document.createElement('input');
            input.type = field.type;
        }
        
        input.id = 'dynamic_' + field.id;
        input.placeholder = field.placeholder;
        input.className = 'dynamic-field';
        input.value = existingData[field.id] || '';
        
        group.appendChild(label);
        group.appendChild(input);
        container.appendChild(group);
    });
}

// ── PORTFOLIO CRUD FUNCTIONS ──
window.openEditWorkModal = function(scriptId = null) {
    const modal = document.getElementById('workModal');
    const form = document.getElementById('workForm');
    const title = document.getElementById('workModalTitle');
    
    if (!modal || !form) return;
    
    form.reset();
    document.getElementById('workId').value = scriptId || '';
    
    let role = currentProfileData?.role || 'Other';
    let roleData = {};

    if (scriptId) {
        title.textContent = 'Edit Portfolio Work';
        const script = currentProfileData?.scripts?.find(s => s.id === scriptId);
        if (script) {
            document.getElementById('workTitle').value = script.title || '';
            document.getElementById('workGenre').value = script.genre || '';
            document.getElementById('workType').value = script.work_type || 'Script';
            document.getElementById('workLink').value = script.media_links || '';
            document.getElementById('workSynopsis').value = script.synopsis || '';
            
            if (script.role_data) {
                try {
                    roleData = JSON.parse(script.role_data);
                } catch(e) { console.error('Failed to parse role_data', e); }
            }
        }
    } else {
        title.textContent = 'Add Portfolio Work';
    }
    
    injectRoleFields(role, roleData);
    
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
};

window.closeWorkModal = function() {
    const modal = document.getElementById('workModal');
    if (modal) modal.classList.remove('active');
    document.body.style.overflow = '';
};

window.deleteWork = async function(scriptId) {
    if (!confirm('Are you sure you want to remove this project from your portfolio?')) return;
    
    try {
        const json = await API.scripts.delete(scriptId);
        
        if (json.success) {
            if (typeof showToast === 'function') showToast('Project removed ✦');
            loadProfile(); 
        } else {
            if (typeof showToast === 'function') showToast(json.message || 'Error deleting project');
        }
    } catch (err) {
        console.error('Delete error:', err);
        if (typeof showToast === 'function') showToast('Connection error');
    }
};

async function handleWorkSubmit(e) {
    e.preventDefault();
    const scriptId = document.getElementById('workId').value;
    const saveBtn = document.getElementById('saveWorkBtn');
    
    const dynamicData = {};
    document.querySelectorAll('.dynamic-field').forEach(field => {
        const key = field.id.replace('dynamic_', '');
        dynamicData[key] = field.value.trim();
    });

    const data = {
        title: document.getElementById('workTitle').value.trim(),
        genre: document.getElementById('workGenre').value.trim(),
        work_type: document.getElementById('workType').value,
        media_links: document.getElementById('workLink').value.trim(),
        synopsis: document.getElementById('workSynopsis').value.trim(),
        role_data: JSON.stringify(dynamicData),
        status: 'Portfolio Item'
    };

    if (!data.title) {
        if (typeof showToast === 'function') showToast('Project title is required ✦');
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }

    try {
        const json = scriptId
            ? await API.scripts.update(scriptId, data)
            : await API.scripts.createPortfolio(data);
        
        if (json.success) {
            if (typeof showToast === 'function') showToast(scriptId ? 'Project updated ✦' : 'Project added ✦');
            closeWorkModal();
            loadProfile();
        } else {
            if (typeof showToast === 'function') showToast(json.message || 'Error saving project');
        }
    } catch (err) {
        console.error('Save error:', err);
        if (typeof showToast === 'function') showToast('Connection error');
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Work ✦';
        }
    }
}
