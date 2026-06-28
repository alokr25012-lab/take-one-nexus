# Changelog / Feature Log

All notable changes to the TAKE ONE Nexus platform will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.2.0] — Creator Rating Deletion, Notifications & Analytics - 2026-06-21

### Added
- **Rating Deletion Flow**: Allows creators to delete a rating they previously submitted, with a confirmation modal, instantly recalculating and updating stats.
- **Rating Notifications**: Triggers standard notifications specifically for new creator ratings, while bypassing updates or deletions.
- **Graphifyy Analytics Event Instrumentation**: Injected persistent database logging for `profile_rated` and `rating_removed` events.

---

## [2.1.0] — Community, Permissions & Observability Hardening - 2026-06-18

### Added
- **Group Member Management Dashboard**: Full-fledged admin UI in chat details for promoting, demoting, and removing community operatives.
- **Join Request Board**: Dedicated approval queues gating community entries.
- **Community Invitation Panel**: Dashboard for moderators/owners to track, resend, or cancel invitations.
- **Graphifyy Analytics**: Lightweight, cookies-free, privacy-preserving web analytics tracking visits and performance metrics.
- **Logo Cache-Busting**: Appended instant-refresh hash tokens to uploaded group and community logos to prevent UI caching lag.
- **Responsive Layout Audits**: Repaired and updated mobile navigation layouts:
  - Fixed Community Chat Navbar layout overlaps.
  - Fixed profile stacked sidebar and mobile separators.
  - Stacked modal forms on small screens.
  - Fixed hybrid device custom cursor behavior.

### Changed
- **CSRF Local Dev Middleware**: Updates to allow non-secure cookies on development environments (`http://localhost`) while keeping `secure` attributes active in production.
- **Session Logout Cookie Options**: Fixed the `maxAge` configuration bug that prevented immediate cookie clearing during user sign-out.
- **Messaging RBAC Policies**: Allowed Community Owners, Admins, and Directors to override communication locks to send important notifications.

---

## [2.0.0] — Payment Gate & Creator Task Engine - 2026-05-26

### Added
- **Razorpay Script Gateway**: Gated all public script uploads behind secure, backend-verified Razorpay payments. Scripts remain in draft status until signatures match.
- **Audited Deletions**: Added backend-authorized script deletion routes for admins and moderators with `SCRIPT_DELETED` system logs.
- **Task Management Panel**: Added `/admin` console controls for creating tasks, approving/rejecting user submissions, manual credit disbursements, and activity logging.

### Fixed
- **Payment Cleanup Job**: Automated draft script garbage collection for cancelled, expired, or invalid transaction logs.

---

## [1.2.0] — Scripts Platform & Creator Verification - 2026-05-24

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

## [1.1.0] — Nexus Security Suite - 2026-05-16

### Added
- **Email Verification Flow**: Full signup → verification email → verified gate. Token lifecycle: generate (crypto) → hash (SHA-256) → store hash → email raw → validate hash → clear.
- **EmailVerificationBanner**: Sticky top banner for unverified users. Calls `POST /api/auth/verify-email` with 60-second resend cooldown. Detects unverified state via `GET /api/users/me`.
- **Password Reset Flow**: `forgot-password` page → `POST /api/auth/forgot-password` (rate-limited, enumeration-safe) → reset email → `reset-password` page with strength meter.
- **3 New Auth Pages**: `/verify-email` (7-state FSM), `/forgot-password`, `/reset-password`.
- **4 New API Routes**: `GET|POST /api/auth/verify-email`, `POST /api/auth/forgot-password`, `POST /api/auth/reset-password`.
- **Cyberpunk Email Templates** (`src/lib/email-templates/`): Inline-HTML emails matching platform design system. Neon gradient headers, expiry timers, feature unlock lists.
- **IP Rate Limiting**: Dual-layer — `src/lib/rate-limiter.ts` (Next.js) and `middleware/rateLimiter.js` (Express). Sliding window, in-memory, fail-open.
- **GDPR Cookie Consent Banner** (`src/components/CookieConsentBanner.tsx`): Slide-up animated banner. Per-category toggles (Essential, Analytics, Replay, Flags). Consent persisted in `localStorage`.
- **PostHog Integration** (`src/lib/posthog.ts` + `PostHogProvider`): Consent-gated. Lazy-loaded via dynamic import. Full input masking. IST timestamps on all events.
- **Sentry Integration** (`src/lib/sentry.ts`): Backend-only. `captureError()` + `withSentry()` wrappers. `beforeSend` PII scrubber.
- **6 New Prisma Fields**: `email_verified`, `email_verified_at`, `verification_token`, `verification_token_expires`, `reset_token`, `reset_token_expires` on `User` model.

### Changed
- `src/proxy.ts`: Email verification gate for `/chat` route.
- `src/app/layout.tsx`: `PostHogProvider` wrapper + two banner components.
- `routes/users.js`: Verification email on register, rate limiters on login/register, `email_verified` in `/me` response.
- `.env.example` + `.env`: Documented and set `RESEND_API_KEY`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `SENTRY_DSN`.

---

## [Unreleased / Source-Available Prep] - 2026-05

### Added
- **NSoC'26 Integration:** Audited and updated the entire documentation workspace to properly acknowledge and integrate support for NSoC'26 (Nexus Summer of Code '26). Added `Community Programs` sections across core repo manuals.
- **Source-Available Documentation:** Complete overhaul of documentation to make the repository production-grade and friendly for NSoC'26 and GSSoC 2026 contributors. Added `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `ROADMAP.md`, and `SECURITY.md`.
- **GitHub Templates:** Added standard Issue and Pull Request templates in `.github`.

### Changed
- Refactored `PROJECT_CONTEXT.md`, `ARCHITECTURE.md`, and `CODING_RULES.md` to align with professional source-available standards.
- Cleaned up legacy documentation and removed duplicated or incomplete markdown files.

---

## [1.0.0-beta] - 2026-05 (Stability Release)

### Added
- **Leaderboard System:** Real-time top-100 ranking UI and backend endpoints based on user credits.
- **Chat Enhancements:** Cursor-based pagination for older messages and sticky date-grouping.
- **Cinematic Profile Page:** Next.js `/profile` route built with full cinematic dark UI, showcasing roles, avatars, credits, and portfolios.
- **Issue Reporting System:** Global bug reporting modal with screenshot support.
- **Admin Panel:** Next.js `/admin` route for issue tracking and user management.
- **Global Chat FAB:** Floating action button across all dynamic routes for quick messaging.
- **SEO Optimization:** Metadata, Open Graph tags, robots.txt, and sitemap generation.

### Changed
- **Unified Role System:** Centralized all role definitions to `public/scripts/constants/roles.js`.
- **Express Routing:** Modularized legacy routes into domain-specific files (`routes/`).
- **Prisma Integration:** Fully replaced raw `mysql2` queries with Prisma ORM for type safety.
- **App Router Migration:** Migrated Next.js components from Pages Router to App Router.

### Fixed
- **Auth Hardening:** Fixed Next.js middleware JWT verification on Vercel Edge. Standardized secure cookie persistence.
- **Admin Authorization:** Hardened admin and moderator role checks.
- **Chat System Null Safety:** Resolved crashes related to deleted users and system messages.
- **Hydration Mismatches:** Fixed client/server render discrepancies on the Profile and Dashboard pages.
- **CORS Policies:** Configured strict wildcard matching for Vercel preview environments.
- **CSS Loading:** Fixed path resolution issues for static assets served by the Express API.

### Security
- Validated server-backed session fetching to prevent local token spoofing.
- Configured HTTP-only cookies to prevent XSS attacks against JWT tokens.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and has been supported by the following community programs:

*   **NSoC'26 (Nexus Spring of Code 2026)**: Project developed under the NSoC'26 timeline to build the foundation of creative and cinematic collaboration tooling.
*   **GSSoC'26 (GirlScript Summer of Code 2026)**: Participating in GSSoC'26 to expand the community modules, onboarding systems, and collaborative production capabilities.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.
