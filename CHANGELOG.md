# 🔄 Changelog

All notable changes to the TAKE ONE Nexus project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] - 2026-06-21

### Added
- **Rating Deletion Flow**: Allows creators to delete a rating they previously submitted, with a confirmation modal, instantly recalculating and updating stats.
- **Rating Notifications**: Triggers standard notifications specifically for new creator ratings, while bypassing updates or deletions.
- **Graphifyy Analytics Event Instrumentation**: Injected persistent database logging for `profile_rated` and `rating_removed` events.

---

## [2.1.0] - 2026-06-18

### Added
- **Group Member Management**: Added full member management dashboard within Group Details panel. Users with Admin or Owner permissions can promote, demote, or remove operatives.
- **Join Requests & Invitations Panels**: Dedicated tabbed interfaces inside Community details to approve/reject join requests and send, track, or cancel invitations.
- **Graphifyy Analytics Integration**: Added a privacy-friendly, cookies-free analytics tracker for user engagement, visit telemetry, and page speed checks.
- **Logo Cache-Busting**: Appended custom query hashes on uploaded group/community logos to force client-side re-render on updates.

### Changed
- **CSRF Local Development Support**: Modified CSRF verification to bypass secure cookie flags in local dev environments (`NODE_ENV !== 'production'`), resolving localhost authentication loops.
- **Messaging Permissions Logic**: Restructured permissions to ensure Group Owners, Admins, and Directors can still message even if communication gating is active.

### Fixed
- **Session Logout Coexistence**: Fixed cookie removal where `maxAge` configurations previously blocked immediate token clearance upon logout.
- **Community Chat Navbar overlap**: Repaired overlapping header elements on the Community Chat page on small viewports.
- **Profile Layout Border & Nav**: Addressed mobile navbar layout errors and stacked sidebar borders on tablet viewports.
- **Hybrid Cursor Response**: Fixed custom cursor feedback anomalies on touch and hybrid devices.

---

## [2.0.0] - 2026-05-26

### Added
- **Razorpay Script Gateway**: Integrated Razorpay payment flow guarding public script submissions.
- **Audited Deletions**: Added backend-authorized script deletion routes for admins and moderators with audit trailing logs (`SCRIPT_DELETED`).
- **Task Management System**: Added `/admin` console controls for creating tasks, approving/rejecting user submissions, manual credit awards, and activity logs.

### Fixed
- **Payment Cleanup**: Automatic draft cleanup job for failed, cancelled, invalid, or expired Razorpay payments.

---

## [1.2.0] - 2026-05-24

### Added
- **Verified Creator Badge**: Added `email_verified` to `GET /api/users/search` and `GET /api/users/leaderboard` SQL routes. Renders a neon verified badge (✦) next to verified names on the leaderboard, profile, and crew pages.
- **Prisma Schema Update**:
  - `Script` model updated with `approval_status` (pending/approved/rejected), `approved_by`, `approved_at`, and `moderation_notes`.
  - `Issue` model updated with `priority` (low/medium/high), `assigned_admin`, and `resolved_at`.
- **Script Review & Moderation API**:
  - `PATCH /api/scripts/:id/moderate` triggers status updates and automated rejection feedback email dispatch via Resend.
  - Broadcasts real-time `SCRIPT_MODERATED` status changes via Pusher WebSockets.
- **Standalone Moderation Hub (`scripts-platform/`)**:
  - Admin login portal under JWT session verification (`SP_JWT_SECRET`).
  - Interactive moderation queue and PDF iframe script viewer.
  - Interactive issue management console supporting status transition logs and priority updates.
  - Strict security headers (`CSP`, `X-Frame-Options: DENY`, `noindex` tags).

---

## [1.1.0] - 2026-05-16 — Nexus Security Suite

### Added
- **Email Verification System**: Automatic verification email on registration via Resend. Tokens are 32-byte crypto-random values stored as SHA-256 hashes. 24-hour expiry with resend support.
- **Email Verification Gate**: `/chat` requires a verified email. Unverified users see a sticky `EmailVerificationBanner` with resend + cooldown timer.
- **Verification Pages**: `/verify-email` (7-state handler), `/forgot-password`, `/reset-password` (real-time strength meter + show/hide toggle).
- **Password Reset Flow**: Secure forgot-password → reset-password. Single-use token (nulled after use), 60-minute expiry.
- **IP-Based Rate Limiting**: Sliding-window in-memory limiters on all auth endpoints. Separate implementations for Next.js (`src/lib/rate-limiter.ts`) and Express (`middleware/rateLimiter.js`). Fail-open design.
- **GDPR Cookie Consent Banner**: Slide-up animated banner — Accept All / Reject / Customize with per-category toggles. Persisted in `localStorage`.
- **PostHog Analytics**: Consent-gated analytics, session replay (all inputs masked), and feature flags via `PostHogProvider`.
- **Sentry Error Monitoring**: Backend-only error capture with PII scrubbing (`beforeSend` hook strips password/token/secret fields).
- **Security Headers**: Strict CSP, X-Frame-Options, and nosniff enabled to prevent XSS and clickjacking.
- **Task Management RBAC**: Gated task assignment endpoints; only authorized `creator` roles can assign tasks to crew.
- **Cyberpunk Email Templates**: `src/lib/email-templates/` — HTML templates for verification and password reset matching the platform's cinematic design system.

### Changed
- `routes/users.js`: Registration sends verification email (async, non-blocking). Rate limiters applied to login (5/15min) and register (3/hr). `email_verified` now returned in login and `/me` responses.
- `src/proxy.ts`: Added email verification gate — unverified users are redirected from `/chat` to `/?verify=required`.
- `src/app/layout.tsx`: Wrapped body in `PostHogProvider`. Added `EmailVerificationBanner` and `CookieConsentBanner`.
- `public/styles/pages/project.css`: Centered the Explore (Trending Scripts) section for better UI alignment.
- `public/scripts/pages/project.js`: Implemented conditional rendering for the search bar (hidden if < 10 scripts).
- `public/scripts/components/global-chat-fab.js`: Updated Chat FAB to trigger login toast/modal instead of redirecting.
- `prisma/schema.prisma` + `db push`: Added 6 security fields to `User` model.
- `.env.example`: Documented all new env vars with purpose comments.

### Security
- SHA-256 token hashing — raw tokens never stored in DB.
- Generic success messages on all auth endpoints to prevent email enumeration.
- Sentry `beforeSend` scrubs PII before transmission.
- PostHog identity traits sanitized before sending.

---

## [1.0.0] - 2026-05-16

### Added
- **Global Timezone Support**: Admin analytics and charts now natively support Indian Standard Time (IST) out of the box, ensuring midnight resets occur correctly for the target demographic.
- **Cinematic Markdown Documentation**: Complete rewrite of all standard documentation including README, CONTRIBUTING, SECURITY, and ROADMAP.
- **Authentication Engine Solidified**: Cleaned up pre-migration references to third-party identity providers, optimizing our secure JWT session architecture and reducing configuration footprints.

### Changed
- **Codebase Optimization**: Removed all unused components, dead code, and debug spam (`console.log`) across frontend and backend for a smaller bundle size and faster execution.
- **UI Architecture**: Moved multiple Express-served pages into the Next.js App Router for better client-side transitions and SEO.

### Fixed
- **API Response Leaks**: Fixed an issue where raw HTML error pages were leaking to the frontend during failed API requests. All API endpoints now return strict JSON.
- **Realtime Listener Leaks**: Cleaned up unmounted component listeners to prevent Pusher memory leaks.
- **Dashboard Synchronization**: Corrected the SQL `GROUP BY` logic so charts don't misalign dates due to UTC offsets.

---

## [0.9.0] - 2026-05-10
### Added
- **Global Chat**: Added real-time direct messaging between users using Pusher Websockets.
- **Credits System**: Implemented the `credits` table and UI components to reward active filmmakers.
- **Admin Command Center**: Added a highly styled, cinematic dashboard for platform telemetry.

### Fixed
- **Database Connection Pooling**: Resolved `Too many connections` errors by using global Prisma singletons and robust Express connection pooling.

---

## [0.1.0] - 2026-01-01
### Added
- Initial project scaffold.
- Basic TiDB integration.
- Static UI shell (Project/Crew/Profile screens).
