import React from 'react';
import { Metadata, ResolvingMetadata } from 'next';
import { getCurrentUser } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { getCanonicalDisplayName } from '@/utils/formatting';
import { USER_ROLES } from '@/lib/constants';
import Script from 'next/script';
import { getAvatarUrl } from '@/lib/avatars';
import './profile.css';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export async function generateMetadata(
  { params, searchParams }: Props,
  parent: ResolvingMetadata
): Promise<Metadata> {
  try {
    await params;
    await searchParams;
    const user = await getCurrentUser();
    
    if (!user) {
      return { title: 'Profile — TAKE ONE' };
    }

    return {
      title: `${user.name || 'Creator'} — TAKE ONE`,
      description: user.bio || `Creator profile on TAKE ONE.`,
    };
  } catch (error) {
    return { title: 'Profile — TAKE ONE' };
  }
}

export default async function ProfilePage({ 
  params, 
  searchParams 
}: { 
  params: Promise<{ id?: string }>, 
  searchParams: Promise<{ [key: string]: string | string[] | undefined }> 
}) {
  try {
    const { id: targetId } = await searchParams;
    const authUser = await getCurrentUser();
    
    let rawUser;
    let isOwner = false;

    if (targetId && !isNaN(Number(targetId)) && authUser?.id !== Number(targetId)) {
      // Viewing someone else's public profile
      const targetUserId = Number(targetId);
      rawUser = await prisma.user.findUnique({
        where: { id: targetUserId },
        include: {
          scripts: {
            orderBy: { created_at: 'desc' }
          }
        }
      });
      
      if (!rawUser) {
        return (
          <div className="profile-auth-gate">
            <div className="auth-kicker">Signal Lost</div>
            <h1>Creator Not Found</h1>
            <p>The transmission signal for this creator ID has been terminated or never existed.</p>
            <div className="auth-actions">
              <a href="/crew" className="auth-primary">Browse Crew</a>
              <a href="/" className="auth-secondary">Back to Nexus</a>
            </div>
          </div>
        );
      }
      isOwner = false;
    } else {
      // Viewing own profile
      rawUser = authUser;
      isOwner = true;

      // Auth Gate if not logged in and no targetId
      if (!rawUser) {
        return (
          <div className="profile-auth-gate" id="profileAuthGate">
            <div className="auth-kicker">Profile Locked</div>
            <h1>Login to open your creator profile</h1>
            <p>Your scripts, requests, skills, and collaboration inbox live here after you sign in.</p>
            <div className="auth-actions">
              <a href="/?auth=login" className="auth-primary">Login →</a>
              <a href="/?auth=register" className="auth-secondary">Create Account</a>
            </div>
          </div>
        );
      }
    }

    // ENSURE POJO SERIALIZATION
    const user = JSON.parse(JSON.stringify(rawUser));

    // STABILITY: Absolute defaults for all fields
    const name = user?.name || 'Creator';
    const role = user?.role || 'Director'; // Default to a valid role from USER_ROLES
    const college = user?.college || '';
    const city = user?.city || '';
    const bio = user?.bio || 'The reel is still being edited. No bio added yet.';
    const scripts = user?.scripts || [];
    const skills = user?.skills ? String(user.skills).split(',').filter(Boolean) : [];
    const avatarUrl = getAvatarUrl(name, user?.gender, user?.avatar_url);
    const screenName = user?.screen_name || '';
    const displayPreference = (user?.display_preference === 'Show Real Name Only' || !user?.display_preference) 
      ? 'Real Name Only' 
      : user.display_preference;
    
    // Display Name Logic
    const displayName = getCanonicalDisplayName(user);
    const credits = user?.credits || 0;

    return (
      <>
        {/* ── TOAST NOTIFICATION ── */}

        {/* ── TOAST NOTIFICATION ── */}
        <div id="toast">Profile saved ✦</div>

        {/* ── HEADER ── */}
        <header>
          <a href="/" className="logo">TAKE <span>ONE</span></a>
          <nav>
            <a href="/">Home</a>
            <a href="/#explore">Discover Projects</a>
            <a href="/crew">Find Crew</a>
            <a href="/leaderboard">Leaderboard</a>
            <a href="/chat" className="nav-chat-link">Messages</a>
            {isOwner && <button className="profile-logout" id="profileLogoutBtn" type="button">Logout</button>}
          </nav>
        </header>

        {/* ── HERO BANNER ── */}
        <div className="profile-hero">
          <div className="hero-reel-deco"></div>
          <div className="hero-reel-deco2"></div>
          <div className="profile-hero-text">TAKE ONE · {isOwner ? 'MY CREATOR PROFILE' : 'VISITING CREATOR'}</div>
          <div className="filmstrip-h"></div>
        </div>

        {/* ── MAIN LAYOUT ── */}
        <div className="profile-main">
          <div className="profile-card">

            {/* ── SIDEBAR ── */}
            <div className="profile-sidebar">
              <div className="avatar-wrap">
                <div className="avatar-ring">
                  <img src={avatarUrl} id="profilePic" alt="Profile Photo" />
                </div>
                {isOwner && (
                  <>
                    <button className="avatar-edit" id="avatarEditBtn" type="button">✎</button>
                    <input type="file" id="avatarInput" accept="image/*" style={{ display: 'none' }} />
                  </>
                )}
              </div>

              <div className="credit-badge-wrap">
                <div className="credit-badge">
                  <div className="cb-label">CREDITS</div>
                  <div className="cb-value">{user?.credits ?? 0}</div>
                  <div className="cb-glow"></div>
                </div>
              </div>

              <div id="profileName" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                {displayName}
                {user.email_verified && (
                  <span className="verified-badge-inline" title="Verified Creator" style={{ display: 'inline-flex', alignItems: 'center' }}>
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--neon)', filter: 'drop-shadow(0 0 4px var(--neon))' }}>
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="var(--neon)" />
                    </svg>
                  </span>
                )}
              </div>
              {screenName && displayPreference !== 'Screen Name Only' && (
                <div className="profile-screen-name">@{screenName}</div>
              )}
              <div className="profile-role" id="profileRole">{role}</div>
              <div className="profile-meta" id="profileMeta">
                {[college, city].filter(Boolean).join(' · ') || 'Location Pending'}
              </div>

              <p className="profile-bio" id="profileBio">{bio}</p>

              <div className="profile-stats">
                <div className="pstat">
                  <div className="pstat-num" id="projCount">{scripts.length}</div>
                  <div className="pstat-label">Scripts</div>
                </div>
                <div className="pstat">
                  <div className="pstat-num" id="skillsCount">{skills.length}</div>
                  <div className="pstat-label">Skills</div>
                </div>
                <div className="pstat">
                  <div className="pstat-num pstat-text" id="profileCity">{city || '--'}</div>
                  <div className="pstat-label">City</div>
                </div>
              </div>

              {isOwner ? (
                <button className="btn-edit-profile" id="sidebarEditBtn">Edit Profile →</button>
              ) : (
                <a href={`/chat?userId=${user.id}`} className="btn-edit-profile" style={{ textAlign: 'center', textDecoration: 'none' }}>Send Message →</a>
              )}

              <div className="skill-badges" id="skillBadges">
                {skills.length > 0 ? (
                  skills.map((skill: string, i: number) => (
                    <span key={i} className="badge">{skill.trim()}</span>
                  ))
                ) : (
                  <span className="badge">Creator</span>
                )}
              </div>

              {/* ── VERIFY EMAIL BANNER — visible only to unverified owners ── */}
              {isOwner && !user.email_verified && (
                <div id="verifyBanner" style={{
                  marginTop: '16px',
                  background: 'linear-gradient(135deg, rgba(255,77,26,0.1), rgba(255,122,26,0.05))',
                  border: '1px solid rgba(255,77,26,0.35)',
                  borderRadius: '8px',
                  padding: '14px 16px',
                }}>
                  <div style={{ fontSize: '9px', letterSpacing: '3px', color: 'var(--neon)', textTransform: 'uppercase', marginBottom: '6px' }}>⚠ Unverified</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-dim)', marginBottom: '12px', lineHeight: '1.5' }}>
                    Verify your email to unlock verified badge and earn 50 credits.
                  </div>
                  <button
                    id="verifyEmailBtn"
                    type="button"
                    style={{
                      background: 'var(--neon)',
                      color: '#06080A',
                      border: 'none',
                      borderRadius: '5px',
                      padding: '8px 14px',
                      fontSize: '10px',
                      fontWeight: '700',
                      letterSpacing: '2px',
                      textTransform: 'uppercase',
                      cursor: 'pointer',
                      width: '100%',
                      boxShadow: '0 0 16px rgba(255,77,26,0.35)',
                    }}
                  >
                    VERIFY EMAIL →
                  </button>
                </div>
              )}
            </div>

            {/* ── MAIN CONTENT ── */}
            <div className="profile-content">
              <div className="content-tabs" id="profileTabs">
                <button className="ctab active" data-tab="projects">Projects</button>
                {isOwner && <button className="ctab"        data-tab="about">About</button>}
                <button className="ctab"        data-tab="collab">{isOwner ? 'Collaborate' : 'Status'}</button>
                <button className="ctab"        data-tab="portfolio">Portfolio</button>
                {isOwner && (
                  <button className="ctab"        data-tab="notifications">
                    Notifications <span className="tab-count" id="notificationCount">0</span>
                  </button>
                )}
              </div>

              {/* ── PROJECTS TAB ── */}
              <div className="tab-pane active" id="tab-projects">
                <div className="section-head">
                  <h3>{isOwner ? 'My Projects' : 'Featured Projects'}</h3>
                  {isOwner && <a href="/#upload" className="btn-sm">+ Add Script</a>}
                </div>
                <div className="project-grid" id="projectGrid">
                  {scripts.length > 0 ? (
                    scripts.map((script: any, i: number) => (
                      <div key={script.id} className="project-card"
                           style={{ background: `linear-gradient(160deg, #1C2330 0%, #06080A 100%)` }}>
                        <div className="pc-num">{String(i + 1).padStart(3, '0')}</div>
                        <div className="pc-genre">{script.genre || 'General'}</div>
                        <div className="pc-title">{script.title || 'Untitled Script'}</div>
                      </div>
                    ))
                  ) : (
                    <div className="project-card empty-guide" style={{ background: '#0E1218', border: '1px dashed #1C2330', gridColumn: '1/-1', padding: '40px', textAlign: 'center' }}>
                      <p style={{ color: '#6B7A8D', fontSize: '12px' }}>Your production history is empty. Upload your first script to begin.</p>
                    </div>
                  )}
                  
                  {isOwner && (
                    <div className="project-card"
                         style={{ 
                            background: 'rgba(255,77,26,0.03)',
                            border: '1px dashed rgba(255,77,26,0.2)',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer'
                         }}
                         id="addProjectAction">
                      <div style={{ fontSize: '28px', color: 'rgba(255,77,26,0.3)', marginBottom: '8px' }}>+</div>
                      <div style={{ fontSize: '8px', letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(255,77,26,0.4)' }}>New Script</div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── ABOUT TAB ── */}
              <div className="tab-pane" id="tab-about">
                <div className="section-head"><h3>About Me</h3></div>
                <div className="about-grid">
                  <div className="about-item">
                    <label htmlFor="editName">Display Name</label>
                    <input type="text" id="editName" defaultValue={name} placeholder="Your name…" />
                  </div>
                  <div className="about-item">
                    <label htmlFor="editRole">Primary Role</label>
                    <select id="editRole" className="profile-role-dropdown" defaultValue={role}>
                      {USER_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="about-item">
                    <label htmlFor="editCollege">College</label>
                    <input type="text" id="editCollege" defaultValue={college} placeholder="FTII, Pune…" />
                  </div>
                  <div className="about-item">
                    <label htmlFor="editCity">City</label>
                    <input type="text" id="editCity" defaultValue={city} placeholder="Mumbai…" />
                  </div>
                  <div className="about-item">
                    <label htmlFor="editGender">Gender</label>
                    <select id="editGender" className="profile-role-dropdown" defaultValue={user?.gender || 'Prefer not to say'}>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                      <option value="Prefer not to say">Prefer not to say</option>
                    </select>
                  </div>
                  <div className="about-item">
                    <label htmlFor="editScreenName">Screen Name / Stage Name</label>
                    <input type="text" id="editScreenName" defaultValue={screenName} placeholder="RK Visuals..." />
                  </div>
                  <div className="about-item">
                    <label htmlFor="editDisplayPreference">Display Preference</label>
                    <select id="editDisplayPreference" className="profile-role-dropdown" defaultValue={displayPreference}>
                      <option value="Real Name Only">Real Name Only</option>
                      <option value="Screen Name Only">Screen Name Only</option>
                      <option value="Both">Both (Name • Screen Name)</option>
                    </select>
                  </div>
                  <div className="about-item full">
                    <label htmlFor="editSocialLinks">Social Links (Instagram, LinkedIn, etc.)</label>
                    <input type="text" id="editSocialLinks" defaultValue={user?.social_links || ''} placeholder="Instagram: @rk_visuals, LinkedIn: rk-sharma..." />
                  </div>
                  <div className="about-item full">
                    <label htmlFor="editPortfolio">Portfolio / Reel</label>
                    <input type="text" id="editPortfolio" defaultValue={user?.portfolio || ''} placeholder="https://…" />
                  </div>
                  <div className="about-item full">
                    <label htmlFor="editBio">Bio</label>
                    <textarea id="editBio" defaultValue={user?.bio || ''} placeholder="Tell the world about your filmmaking journey…"></textarea>
                  </div>
                  <div className="about-item full">
                    <label htmlFor="editSkills">Skills (comma separated)</label>
                    <input type="text" id="editSkills" defaultValue={user?.skills || ''} placeholder="Direction, Screenplay, Color Grading, VFX… " />
                  </div>
                </div>
                <button className="save-btn" id="saveProfileBtn">Save Changes →</button>
              </div>

              {/* ── COLLABORATE TAB ── */}
              <div className="tab-pane" id="tab-collab">
                <div className="section-head"><h3>Collaborate</h3></div>
                <div className="collab-board" id="collabBoard">
                  <div className="collab-column">
                    <div className="collab-column-title">Requests For My Scripts</div>
                    <div id="incomingRequests" className="request-list">
                      <div className="collab-empty"><div className="collab-reel"><span>🎬</span></div><p>Loading requests...</p></div>
                    </div>
                  </div>
                  <div className="collab-column">
                    <div className="collab-column-title">My Sent Requests</div>
                    <div id="outgoingRequests" className="request-list">
                      <div className="collab-empty"><div className="collab-reel"><span>🎬</span></div><p>Loading requests...</p></div>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── PORTFOLIO TAB ── */}
              <div className="tab-pane" id="tab-portfolio">
                <div className="section-head">
                  <h3>Creative Portfolio</h3>
                  <div className="portfolio-badge">PRO PROFILE</div>
                </div>
                <div className="portfolio-container">
                  <div className="portfolio-intro">
                    <div className="pi-num">ROLE: {role.toUpperCase()}</div>
                    <p>Showcasing specialized work, gear, and professional milestones.</p>
                  </div>
                  
                  <div className="portfolio-role-details" id="portfolioRoleDetails">
                    {/* Inject role-specific details here via profile.js */}
                    <div className="collab-empty">
                      <div className="collab-reel"><span>⚙</span></div>
                      <p>Complete your profile to see specialized role cards</p>
                    </div>
                  </div>

                  <div className="portfolio-grid-head">Featured Work</div>
                  <div className="portfolio-grid" id="portfolioGrid">
                    {/* Inject featured work cards here via profile.js */}
                    <div className="collab-empty">
                        <p>No featured work added to portfolio yet.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* ── NOTIFICATIONS TAB ── */}
              <div className="tab-pane" id="tab-notifications">
                <div className="section-head">
                  <h3>Notifications</h3>
                  <button className="btn-sm" type="button" id="markReadBtn">Mark All Read</button>
                </div>
                  <div className="notification-list" id="notificationList">
                  <div className="collab-empty"><div className="collab-reel"><span>•</span></div><p>Loading notifications...</p></div>
                </div>
              </div>{/* /.tab-notifications */}
            </div>{/* /.profile-content */}
          </div>{/* /.profile-card */}

          <div style={{ height: '60px' }}></div>
        </div>{/* /.profile-main */}

          {/* ── PORTFOLIO EDIT MODAL ── */}
          <div className="modal-overlay" id="workModal">
            <div className="modal-content portfolio-modal">
              <div className="modal-header">
                <h2 id="workModalTitle">Add Portfolio Work</h2>
                <button className="modal-close" id="closeWorkModal">×</button>
              </div>
              <div className="modal-body">
                <form id="workForm">
                  <input type="hidden" id="workId" />
                  
                  {/* Base Fields */}
                  <div className="form-group">
                    <label>Project Title</label>
                    <input type="text" id="workTitle" placeholder="Project Title" required />
                  </div>
                  
                  <div className="form-row">
                    <div className="form-group">
                      <label>Primary Genre</label>
                      <input type="text" id="workGenre" placeholder="e.g. Sci-Fi, Horror" />
                    </div>
                    <div className="form-group">
                      <label>Project Type</label>
                      <select id="workType">
                        <option value="Script">Script</option>
                        <option value="Short Film">Short Film</option>
                        <option value="Feature Film">Feature Film</option>
                        <option value="Music Video">Music Video</option>
                        <option value="Reel">Reel / Montage</option>
                        <option value="Commercial">Commercial</option>
                        <option value="Other">Other</option>
                      </select>
                    </div>
                  </div>

                  {/* Dynamic Role-Based Fields Container */}
                  <div id="roleDynamicFields"></div>

                  <div className="form-group">
                    <label>Media Link (YouTube/Vimeo/Drive/Behance)</label>
                    <input type="url" id="workLink" placeholder="https://..." />
                  </div>

                  <div className="form-group">
                    <label>Description / Synopsis</label>
                    <textarea id="workSynopsis" placeholder="Brief description of your project and your contribution..."></textarea>
                  </div>

                  <button type="submit" className="save-btn" id="saveWorkBtn" style={{ width: '100%' }}>Save Work ✦</button>
                </form>
              </div>
            </div>
          </div>

          {/* ── STATUS BAR ── */}
          <div className="status-bar">
            <div className="status-item"><div className="status-dot"></div>Profile Active</div>
            <div className="status-item">TAKE ONE · Creator Mode</div>
            <div className="status-item" id="statusTime"></div>
          </div>

          {/* ── OTP VERIFICATION MODAL ── */}
          {isOwner && !user.email_verified && (
            <div id="otpModal" style={{
              display: 'none',
              position: 'fixed', inset: 0,
              background: 'rgba(6,8,10,0.92)',
              backdropFilter: 'blur(8px)',
              zIndex: 9999,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <div style={{
                background: 'var(--machine)',
                border: '1px solid rgba(255,77,26,0.3)',
                borderRadius: '12px',
                padding: '40px',
                width: '100%',
                maxWidth: '420px',
                position: 'relative',
                boxShadow: '0 0 60px rgba(255,77,26,0.12)',
              }}>
                {/* Filmstrip top accent */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: 'linear-gradient(90deg, var(--neon), var(--neon2))', borderRadius: '12px 12px 0 0' }}></div>

                <button id="otpModalClose" style={{ position: 'absolute', top: '16px', right: '16px', background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '18px', lineHeight: 1 }}>✕</button>

                <div style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '22px', letterSpacing: '6px', color: 'var(--neon)', marginBottom: '6px' }}>VERIFY IDENTITY</div>
                <div style={{ fontSize: '10px', letterSpacing: '2px', color: 'var(--silver)', marginBottom: '24px', textTransform: 'uppercase' }}>Enter the 6-digit code sent to your email</div>

                <div id="otpError" style={{ display: 'none', background: 'rgba(255,51,102,0.1)', border: '1px solid rgba(255,51,102,0.3)', borderRadius: '6px', padding: '10px 14px', fontSize: '11px', color: 'var(--red)', marginBottom: '16px', letterSpacing: '1px' }}></div>
                <div id="otpSuccess" style={{ display: 'none', background: 'rgba(0,255,136,0.08)', border: '1px solid rgba(0,255,136,0.25)', borderRadius: '6px', padding: '10px 14px', fontSize: '11px', color: 'var(--green)', marginBottom: '16px', letterSpacing: '1px' }}></div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                  {[0,1,2,3,4,5].map(i => (
                    <input
                      key={i}
                      id={`otp-digit-${i}`}
                      type="text"
                      inputMode="numeric"
                      maxLength={1}
                      style={{
                        width: '48px', height: '56px',
                        background: 'var(--panel)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                        color: 'var(--neon)',
                        fontSize: '24px',
                        fontWeight: '700',
                        textAlign: 'center',
                        fontFamily: 'Space Mono, monospace',
                        outline: 'none',
                        flex: 1,
                        transition: 'border-color 0.2s',
                      }}
                    />
                  ))}
                </div>

                <button id="otpConfirmBtn" type="button" style={{
                  width: '100%',
                  background: 'var(--neon)',
                  color: '#06080A',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '13px',
                  fontSize: '11px',
                  fontWeight: '700',
                  letterSpacing: '3px',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  marginBottom: '14px',
                  boxShadow: '0 0 20px rgba(255,77,26,0.3)',
                }}>CONFIRM CODE</button>

                <div style={{ textAlign: 'center' }}>
                  <button id="otpResendBtn" type="button" style={{
                    background: 'none', border: 'none',
                    color: 'var(--silver)', fontSize: '10px',
                    letterSpacing: '2px', textTransform: 'uppercase',
                    cursor: 'pointer', textDecoration: 'underline',
                  }}>Resend Code</button>
                  <span id="otpCooldown" style={{ display: 'none', color: 'var(--silver)', fontSize: '10px', letterSpacing: '2px' }}></span>
                </div>
              </div>
            </div>
          )}

        <Script src="/scripts/utils/helpers.js" strategy="afterInteractive" />
        <Script src="/scripts/components/ui.js" strategy="afterInteractive" />
        <Script src="/scripts/animations/common.js" strategy="afterInteractive" />
        <Script src="/scripts/pages/profile.js" strategy="afterInteractive" />
        <Script id="otp-init" strategy="afterInteractive">{`
          (function () {
            var globalVerifyBtn = document.getElementById('verifyEmailBtn');
            if (globalVerifyBtn) {
              globalVerifyBtn.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopImmediatePropagation();
                window.dispatchEvent(new CustomEvent('takeone:open-email-verification'));
              }, true);
            }

            var verifyBtn = document.getElementById('verifyEmailBtn');
            var modal     = document.getElementById('otpModal');
            var closeBtn  = document.getElementById('otpModalClose');
            var confirmBtn= document.getElementById('otpConfirmBtn');
            var resendBtn = document.getElementById('otpResendBtn');
            var errBox    = document.getElementById('otpError');
            var okBox     = document.getElementById('otpSuccess');
            var cooldown  = document.getElementById('otpCooldown');
            var resendTimer = null;

            // Fetch CSRF token before every mutating request
            async function getCsrfToken() {
              try {
                var res = await fetch('/api/csrf-token', { credentials: 'include' });
                var data = await res.json();
                return data.csrfToken || '';
              } catch (e) {
                return '';
              }
            }

            function getCode() {
              return [0,1,2,3,4,5].map(function(i){
                return (document.getElementById('otp-digit-'+i)||{}).value||'';
              }).join('');
            }

            function showErr(msg) {
              if (errBox) { errBox.textContent = msg; errBox.style.display = 'block'; }
              if (okBox)  { okBox.style.display = 'none'; }
            }

            function showOk(msg) {
              if (okBox)  { okBox.textContent = msg; okBox.style.display = 'block'; }
              if (errBox) { errBox.style.display = 'none'; }
            }

            function startCooldown(secs) {
              if (!cooldown || !resendBtn) return;
              resendBtn.style.display = 'none';
              cooldown.style.display  = 'inline';
              var remaining = secs;
              resendTimer = setInterval(function() {
                remaining--;
                cooldown.textContent = 'Resend in ' + remaining + 's';
                if (remaining <= 0) {
                  clearInterval(resendTimer);
                  cooldown.style.display  = 'none';
                  resendBtn.style.display = 'inline';
                }
              }, 1000);
              cooldown.textContent = 'Resend in ' + secs + 's';
            }

            // Wire OTP digit auto-advance
            [0,1,2,3,4,5].forEach(function(i) {
              var el = document.getElementById('otp-digit-'+i);
              if (!el) return;
              el.addEventListener('input', function() {
                el.value = el.value.replace(/[^0-9]/g,'').slice(-1);
                if (el.value && i < 5) document.getElementById('otp-digit-'+(i+1)).focus();
              });
              el.addEventListener('keydown', function(e) {
                if (e.key === 'Backspace' && !el.value && i > 0) document.getElementById('otp-digit-'+(i-1)).focus();
              });
            });

            // Open modal + auto-send OTP
            if (verifyBtn && modal) {
              verifyBtn.addEventListener('click', async function() {
                modal.style.display = 'flex';
                var csrfToken = await getCsrfToken();
                fetch('/api/otp/send', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
                })
                  .then(function(r){ return r.json(); })
                  .then(function(d){
                    if (d.success) startCooldown(60);
                    else showErr(d.message || 'Failed to send code');
                  })
                  .catch(function(){ showErr('Connection error. Try again.'); });
              });
            }

            if (closeBtn && modal)  closeBtn.addEventListener('click', function(){ modal.style.display='none'; });

            if (confirmBtn) {
              confirmBtn.addEventListener('click', async function() {
                var code = getCode();
                if (code.length !== 6) { showErr('Please enter the full 6-digit code.'); return; }
                confirmBtn.textContent = 'VERIFYING...';
                confirmBtn.disabled = true;
                var csrfToken = await getCsrfToken();
                fetch('/api/otp/confirm', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
                  body: JSON.stringify({ otp: code })
                })
                .then(function(r){ return r.json(); })
                .then(function(d){
                  confirmBtn.textContent = 'CONFIRM CODE';
                  confirmBtn.disabled = false;
                  if (d.success) {
                    showOk('Email verified! Credits awarded. Reloading...');
                    setTimeout(function(){ window.location.reload(); }, 1800);
                  } else {
                    showErr(d.message || 'Invalid code');
                  }
                })
                .catch(function(){
                  confirmBtn.textContent = 'CONFIRM CODE';
                  confirmBtn.disabled = false;
                  showErr('Connection error. Try again.');
                });
              });
            }

            if (resendBtn) {
              resendBtn.addEventListener('click', async function() {
                var csrfToken = await getCsrfToken();
                fetch('/api/otp/send', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken }
                })
                  .then(function(r){ return r.json(); })
                  .then(function(d){
                    if (d.success) { showOk('New code sent!'); startCooldown(60); }
                    else showErr(d.message || 'Failed to resend code');
                  })
                  .catch(function(){ showErr('Connection error. Try again.'); });
              });
            }
          })();
        `}</Script>

      </>
    );
  } catch (criticalError: any) {
    console.error('[CRITICAL_PROFILE_RENDER_FAILURE]:', criticalError?.message);
    
    // Attempt to extract helpful details for debugging
    const errorMsg = criticalError?.message || 'Unknown render failure';
    const errorStack = criticalError?.stack || '';

    return (
      <div className="profile-error-fallback" style={{ background: '#06080A', color: '#E8DFC8', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center', position: 'relative' }}>
        {/* Cinematic noise overlay */}
        <div style={{ position: 'absolute', inset: 0, opacity: 0.05, pointerEvents: 'none', background: 'repeating-linear-gradient(0deg, #000, #000 1px, transparent 1px, transparent 2px)', backgroundSize: '100% 2px' }}></div>
        
        <h1 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: '48px', color: '#FF4D1A', marginBottom: '10px', letterSpacing: '4px' }}>SIGNAL RECOVERY MODE</h1>
        <div style={{ width: '60px', height: '2px', background: '#FF4D1A', marginBottom: '30px' }}></div>
        
        <p style={{ color: '#6B7A8D', maxWidth: '500px', margin: '0 0 20px 0', fontSize: '13px', lineHeight: '1.6', letterSpacing: '1px' }}>
          The production server encountered a rendering issue while decrypting this profile. 
          We are currently operating in high-stability fallback mode.
        </p>
        
        {process.env.NODE_ENV === 'development' && (
          <div style={{ background: 'rgba(255, 77, 26, 0.05)', border: '1px solid rgba(255, 77, 26, 0.2)', padding: '15px', marginBottom: '30px', fontSize: '10px', color: '#FF4D1A', textAlign: 'left', maxWidth: '80%', overflow: 'auto', fontFamily: 'monospace' }}>
            {errorMsg}
          </div>
        )}

        <div style={{ display: 'flex', gap: '20px' }}>
          <a href="/" style={{ border: '1px solid #FF4D1A', color: '#FF4D1A', padding: '12px 24px', textDecoration: 'none', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.2em', transition: 'all 0.3s ease' }}>Return Home</a>
          <a href="" style={{ background: '#FF4D1A', color: '#06080A', border: 'none', padding: '12px 24px', textTransform: 'uppercase', fontSize: '10px', letterSpacing: '0.2em', cursor: 'pointer', fontWeight: 'bold', textDecoration: 'none' }}>Retry Uplink</a>
        </div>
        
        <div style={{ marginTop: '40px', fontSize: '8px', color: '#333', letterSpacing: '3px' }}>
          NEXUS SIGNAL ERROR CODE: {criticalError?.digest || 'UNKNOWN_FRAGMENT'}
        </div>
      </div>
    );
  }
}
