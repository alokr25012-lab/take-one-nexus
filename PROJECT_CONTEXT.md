# PROJECT CONTEXT — TAKE ONE Nexus

> A cinematic film crew collaboration platform. Connects filmmakers, creators, photographers, editors, writers, and production teams across campuses to share scripts, find crew, form communities, and build productions together.

---

## 🎯 Product Vision

**TAKE ONE Nexus** is an open-source, role-based creative ecosystem designed specifically for filmmakers and independent creators.

Our goal is to solve a fundamental problem in creative industries: **Crew Discovery and Management**. By building a highly stylized, cinematic digital platform, we provide a unified space where creatives can:
- Showcase their work in a professional **Portfolio**.
- Find collaborators based on precise **Creative Roles** (Director, DP, Editor, Photographer, Writer, etc.).
- Form and discover specialized **Communities** and manage their teams.
- Communicate securely via **Real-Time Chat** (requires verified email).
- Earn **Creator Credits** as reputation points for participating in the ecosystem.

**Live URL:** [takeone-nexus.net.in](https://takeone-nexus.net.in)

---

## 🏗️ Architecture Summary

TAKE ONE Nexus uses a robust **dual-server architecture**:
- **Next.js App Router (`src/app/`)**: Handles dynamic, authenticated pages (Profile, Chat, Admin, Communities, Auth flows).
- **Express.js API (`server.js`)**: Serves as a standalone backend API and hosts static, vanilla HTML/JS/CSS pages (`public/*.htm`).

Both services are deployed simultaneously on **Vercel** using `@vercel/node` for the Express backend and the standard Next.js builder.

---

## ⚙️ Business Logic & Systems

### 1. The Role System
Roles are the central identifier for users and projects.
- **Source of Truth**: `public/scripts/constants/roles.js`
- **Supported Roles**: Director, Cinematographer / DP, Writer, Editor, Sound Designer, Designer, Developer, Actor, Producer, Lighting Crew, Set Support, Photographer, Other.
- This taxonomy drives user registration, crew directory filtering, and dynamic portfolio generation.

### 2. Portfolio & Work Showcase
Creators use their profile as a digital reel.
- **Dynamic Forms**: Based on a user's role, the portfolio upload system requests different metadata (e.g., a "Writer" uploads a script synopsis, a "Director" embeds a Vimeo link).
- **Public Visibility**: Unauthenticated users can view public profiles (`GET /api/users/public/:id`) to vet collaborators before initiating a chat.

### 3. Real-Time Chat System
Secure transmission for project collaboration — **requires verified email**.
- **Powered by Pusher**: WebSockets provide instant message delivery.
- **Role-Based Groups**: Production channels feature explicit roles (Director, Admin, Member) via a junction table schema.
- **Mission Assignment & RBAC**: Integrated Task Management allows `creator` or `admin` roles to assign "missions" to crew members. Only authorized users can create/edit tasks, while crew can only mark their assigned tasks as complete.
- **Cinematic UI**: Cursor-based pagination, intelligent date-grouping, and tabbed interface for Transmissions vs. Missions.

### 4. Communities & Member Management
Comprehensive collaboration hubs for creative teams.
- **Join Requests & Invitations**: Users can apply to join groups, or administrators can send direct invitations. Contains dedicated dashboards to approve/reject requests or cancel/resend invitations.
- **Role Elevation**: Elevate members to Group Admins or demote them back to standard members.
- **Logo Customization**: Supports custom group logos with query-based cache-busting to guarantee instant visual updates.

### 5. Creator Credits & Leaderboard
The heartbeat of the Nexus economy.
- **Earning**: Users earn credits for completing missions. Missions are assigned in chat, completed by the operative, and approved by a Director/Admin.
- **Credit Transaction Engine**: Every credit earned is recorded in an immutable `CreditTransaction` audit log, ensuring transparency and security.
- **Real-Time Leaderboard**: A dynamic Next.js page (`/leaderboard`) ranks the top 100 creators globally, updating instantly via Pusher events (`leaderboard-update`) whenever credits are granted.

### 6. Email Verification System
Full lifecycle email verification to secure platform access.
- **On Registration**: A verification email is sent automatically via Resend with a 24-hour expiry token.
- **Access Gate**: Unverified users cannot access `/chat`. A sticky `EmailVerificationBanner` prompts resend with a 60-second cooldown.
- **Token Security**: Tokens are 32-byte cryptographically random values stored as SHA-256 hashes. The raw token only travels in the email link — never in the database.
- **Pages**: `/verify-email` (handles all verification states), `/forgot-password`, `/reset-password` (with password strength meter).

### 7. IP-Based Rate Limiting & Security Headers
Comprehensive network and browser-level security defenses.
- **Next.js API routes**: Sliding-window rate limiters via `src/lib/rate-limiter.ts`.
- **Express routes**: Helmet middleware for security headers, and `middleware/rateLimiter.js` for IP-based limits (Login: 5/15min, Register: 3/hour).
- **Security Headers**: Strict Content Security Policy (CSP), X-Frame-Options (DENY), and nosniff enabled globally to prevent XSS, clickjacking, and MIME-sniffing.
- **Fail-open design**: Limiter errors never block legitimate users.

### 8. GDPR Cookie Consent
Production-grade consent management with granular controls.
- **Banner**: Slide-up animated `CookieConsentBanner` with Accept All / Reject / Customize options.
- **Categories**: Essential (always on), Analytics, Session Replay, Feature Flags.
- **Persistence**: Consent stored in `localStorage` under `ton_cookie_consent`. Custom `consentUpdated` DOM event triggers PostHog re-initialization without page reload.

### 9. Observability & Telemetry
Separated concerns between analytics, behavior tracking, and error monitoring.
- **Graphifyy Analytics**: Privacy-friendly, cookies-free analytics tracking user visits, sources, and page loading speed.
- **PostHog** (`src/lib/posthog.ts`): Frontend behavioral tracking, session replay (with input masking), and feature flags. Requires cookie consent.
- **Sentry** (`src/lib/sentry.ts`): Backend API and server exception tracking. Automatically scrubs `password`, `token`, `secret`, and `key` from logs before sending.

### 10. Razorpay Payment Gateway
Ensures financial audit integrity.
- **Draft to Public**: Script submissions remain temporary drafts until payment is verified.
- **Signature verification**: Performed server-side on raw body buffers to prevent webhook spoofing.
- **Cleanup job**: Automatically clears expired or failed payment drafts.

---

## 🔒 Security & Auth

- **Authentication**: JWT-based auth. Tokens are stored in secure, `HttpOnly` cookies to prevent XSS attacks.
- **Email Verification**: Required to access messaging features. Token hashing prevents token enumeration attacks. All auth endpoints return generic success messages to prevent email enumeration.
- **Authorization**: Role-based access control (RBAC). Admin, Developer, and Moderator roles have access to the Next.js `/admin` dashboard.
- **Rate Limiting**: All auth and payment endpoints are rate-limited by IP using sliding-window counters.
- **Issue Tracking**: A global `GlobalIssueReporter` allows any user to report bugs or malicious behavior securely to the admin panel.

---

## 🚀 Deployment & Scaling Plans

### Current Deployment (Vercel)
- Vercel's Edge network routes static assets and Next.js pages.
- `vercel.json` rewrite rules proxy `/api/*` to the Express Serverless Function.
- Database: **MySQL** hosted on TiDB Cloud, managed via Prisma ORM.
- Transactional Email: **Resend** via `takeone-nexus.net.in` custom domain.

### Scaling Roadmap
As the platform grows, we plan to decouple the monolithic architecture:
1. **Persistent Collaboration**: Transitioning from ephemeral chat to persistent project hubs with centralized asset management.
2. **CDN Optimization**: User uploaded media (avatars, posters, community logos) will be migrated to dedicated object storage (AWS S3/CloudFront).
3. **Public API**: Implementing `/api/v1/` for external integrations and the upcoming mobile app.
4. **Rate Limiting at Scale**: Transitioning in-memory limiters to a distributed sliding-window mechanism (e.g. Upstash Redis) when horizontal server scaling is introduced.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Supported development of the core security architecture, double-submit CSRF, and JWT authorization rules.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

---

## 🤝 Join the Production

We are constantly improving. If you are participating in **NSoC'26** or **GSSoC 2026**, this document is your foundation. Check out [ARCHITECTURE.md](ARCHITECTURE.md) for deep technical details and [CONTRIBUTING.md](CONTRIBUTING.md) to start pushing code!
