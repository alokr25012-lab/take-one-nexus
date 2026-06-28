# 🏛️ TAKE ONE Nexus — Architecture

TAKE ONE Nexus uses a highly optimized, hybrid architecture designed to balance SEO, rapid client-side interactivity, robust real-time communication, and production-grade security.

---

## 1. The Dual-Server Model

Due to the transition from a purely static/Express application to a modern Next.js ecosystem, the platform employs a **Dual-Server Model** hosted on Vercel:

### A. Next.js App Router (`src/app/`)
- **Purpose**: Authenticated pages, auth flows, and all API routes that require server-side logic or database access.
- **Execution**: SSR, Static Generation, and Client Components.
- **Key Routes**:
  | Route | Type | Purpose |
  |---|---|---|
  | `/` | Static | Landing page |
  | `/profile` | Dynamic SSR | Authenticated user profile |
  | `/chat` | Static shell | Real-time messaging (verified users only) |
  | `/admin` | Dynamic SSR | Admin dashboard (role-gated) |
  | `/verify-email` | Static | Email verification status page |
  | `/forgot-password` | Static | Password recovery request |
  | `/reset-password` | Static | New password form |
  | `/api/auth/verify-email` | API Route | Token validation + resend |
  | `/api/auth/forgot-password` | API Route | Reset email dispatch |
  | `/api/auth/reset-password` | API Route | Password update |
  | `/leaderboard` | Dynamic SSR | Top 50 creators |

### B. Legacy Express Server (`server.js`)
- **Purpose**: Core REST API for data mutations. Serves legacy static `.htm` pages (`/public`).
- **Execution**: Serverless Function on Vercel.
- **Routing**: Core application APIs are handled by the Express server, while authentication-related routes may be served by Next.js Route Handlers depending on the route configuration.

#### API Route Ownership

To support the dual-server architecture, API responsibilities are divided between Next.js and Express:

| Route Pattern | Handler |
|---|---|
| `/api/auth/verify-email` | Next.js Route Handler |
| `/api/auth/forgot-password` | Next.js Route Handler |
| `/api/auth/reset-password` | Next.js Route Handler |
| `/api/users/*` | Express Server |
| `/api/chat/*` | Express Server |
| `/api/ratings/*` | Express Server |
| `/api/system/*` | Express Server |

This separation helps contributors understand which framework is responsible for handling specific API endpoints within the application.

- **Key Express Routes**:
  | Route | Auth | Purpose |
  |---|---|---|
  | `POST /api/users/register` | None | Registration + verification email |
  | `POST /api/users/login` | None | Login + `email_verified` in response |
  | `GET /api/users/me` | JWT | Session data (incl. `email_verified`) |
  | `GET /api/users/public/:id` | None | Public profile view |
  | `GET /api/chat/*` | JWT | Real-time message history |
  | `POST /api/ratings` | JWT | Submit or edit creator rating; triggers notification on new rating, logs `profile_rated` |
  | `GET /api/ratings/status/:userId` | JWT | Fetch rating status for a target creator, including average score and user rating |
  | `DELETE /api/ratings/:ratedUserId` | JWT | Remove rating; logs `rating_removed` and updates statistics |
  | `GET /api/system/stats` | Admin | Live platform metrics |

> **Routing Magic**: `vercel.json` rewrite rules map `/api/*` to Express while Next.js handles everything else.

### C. Admin Panel Subdomain Decoupling
- **Apex Domain**: `takeone-nexus.net.in`
- **Admin Subdomain**: `admin.takeone-nexus.net.in`
- **Decoupled Architecture**: The admin panel is decoupled into its own codebase, referencing the central API server.
- **Subdomain Cookie Sharing**: Auth sessions share a common apex domain configuration: `domain: '.takeone-nexus.net.in'` on cookies. Users possessing the correct `secondary_role` permissions (e.g. `Admin`) can navigate to the admin console without re-authenticating.

---

## 2. Middleware & Authentication

### `src/proxy.ts`
The Next.js Edge Middleware validates the HTTP-only JWT cookie and enforces access rules before any page renders.

**Access Matrix:**
| Route | Unauthenticated | Authenticated (Unverified) | Authenticated (Verified) | Admin |
|---|---|---|---|---|
| `/` | ✅ | ✅ | ✅ | ✅ |
| `/profile` | 🔀 login | ✅ (sees banner) | ✅ | ✅ |
| `/chat` | 🔀 login | 🔀 `/?verify=required` | ✅ | ✅ |
| `/admin` | 🔀 login | 🔀 unauthorized | 🔀 unauthorized | ✅ |

**JWT Payload fields checked by middleware:**
- `id`, `email`, `role` — authorization
- `secondary_role` — admin authorization checks
- `email_verified` — chat access gate

### Express `middleware/auth.js`
Stateless JWT verification for Express API routes. Re-uses the same `JWT_SECRET`.

---

## 3. Database & ORM Layer

### TiDB Cloud (MySQL-compatible)
Distributed SQL database. Accessed from both the Express API (via `mysql2` connection pool) and Next.js App Router (via Prisma).

### Prisma ORM (`prisma/schema.prisma`)
Single source of truth for the database schema. Generated client types are used across all Next.js API routes.

**`User` model security fields:**
```prisma
email_verified          Boolean?   @default(false)
email_verified_at       DateTime?
verification_token      String?    @unique  // SHA-256 hash of raw token
verification_token_expires DateTime?
reset_token             String?    @unique  // SHA-256 hash of raw token
reset_token_expires     DateTime?
```

**`Script` model moderation fields:**
```prisma
approval_status   String?   @default("pending")  // pending | approved | rejected
approved_by       Int?      // FK → User.id of the moderating admin
approved_at       DateTime?
moderation_notes  String?   @db.Text
```

**`Issue` model admin fields:**
```prisma
priority          String?   @default("medium")   // low | medium | high
assigned_admin    Int?      // FK → User.id of assigned moderator
resolved_at       DateTime?
```

> **Security principle**: Raw tokens are 32-byte `crypto.randomBytes` values. Only SHA-256 hashes are stored in the database. The raw token travels exclusively in the email link.

---

## 4. Email Infrastructure (Resend)

All transactional emails are delivered via **Resend** using the custom domain `takeone-nexus.net.in`.

| Email | Trigger | Template |
|---|---|---|
| Welcome | On registration | `utils/email.js` |
| Email Verification | On registration + resend | `src/lib/email-templates/verify-email.ts` |
| Password Reset | On forgot-password request | `src/lib/email-templates/reset-password.ts` |

---

## 5. Rate Limiting

**Backing Store**: Pure, high-performance in-memory sliding-window Map. Since rate limiting is active locally and in production on a per-instance basis, no external database or backing stores are required, eliminating latency overhead.

Dual-layer rate limiting — Next.js and Express both protected independently.

### `src/lib/rate-limiter.ts` (Next.js API Routes)
- Sliding-window in-memory rate limiter.
- Key format: `prefix:ip` or `prefix:type:value`.
- Fail-open: limiter errors never block legitimate traffic.

### `middleware/rateLimiter.js` (Express Routes)
- Sliding-window in-memory rate limiter.
- Applied as route-level middleware via `createRateLimiter({ limit, windowMs })`.

**Configured limits:**
| Endpoint | Limit | Window | Key Prefix |
|---|---|---|---|
| Login | 5 requests | 15 min | `login` |
| Register | 3 requests | 60 min | `register` |
| Verification | 3 requests | 60 min | `verify` |
| Payments | 10 requests | 15 min | `payment` |
| Portfolio Uploads | 20 requests | 60 min | `portfolio` |
| Issue Reporting | 20 requests | 15 min | `issues` |
| Task Creation | 30 requests | 15 min | `task-create` |

---

## 6. CSRF Double-Submit Protection

To defend state-changing API endpoints, TAKE ONE Nexus implements a stateless **Double-Submit Cookie Pattern**:

1. **Global Cookie Placement**: Every HTTP response sets a `csrf_token` cookie (Secure in production, sameSite: strict, path: `/`, readable by JS).
2. **Client-Side Header Binding**: The frontend reads `csrf_token` from cookies and appends it to all state-changing requests (POST, PUT, PATCH, DELETE) as the `X-CSRF-Token` header.
3. **Server-Side Verification**: Express middleware (`verifyCsrfToken`) checks for cookie/header parity in constant-time. Requests with missing or mismatching tokens are rejected with a `403 Forbidden` response.
4. **Exemptions**: Safe methods (GET, HEAD, OPTIONS) and webhook endpoints (protected by cryptographic signature validations) bypass this middleware.

---

## 7. Security Headers

Strict HTTP headers are enforced globally via Next.js configurations and Helmet middleware in Express:
- **Content Security Policy (CSP)**: Strict resource limits, frame-ancestors control.
- **X-Frame-Options (`DENY`)**: CLICKJACKING protection.
- **X-Content-Type-Options (`nosniff`)**: MIME-sniff protection.
- **Referrer-Policy (`strict-origin-when-cross-origin`)**: Cross-origin leak protection.
- **Permissions-Policy**: Disables geolocation/microphone access globally.

---

## 8. Observability

### Graphifyy Analytics
- **Used for**: Privacy-friendly web telemetry, user engagement tracking, and page load performance insights.
- **Privacy**: Cookies-free, lightweight tracker executing client-side with full user privacy conservation.

### PostHog (`src/lib/posthog.ts`)
- **Used for**: Frontend behavioral analytics, session replay, and feature flags.
- **Privacy**: Input masking enabled by default. Sensitive fields (passwords, tokens, keys) are stripped from attributes prior to transmission. Gated by GDPR cookie consent.

### Sentry (`src/lib/sentry.ts`)
- **Used for**: Backend API failure logging, database execution error monitoring.
- **Privacy**: `beforeSend` hook filters sensitive request body parameters.

---

## 9. Real-Time Telemetry (Pusher)

Pusher WebSockets drive the live creative interaction layers:
- **Global Chat**: Direct peer-to-peer messaging.
- **Admin Dashboard**: Live system metrics.
- **Task Updates**: Live Nexus Credit awards.
- **Script Moderation**: Real-time event propagation when script status is updated.

---

## Architectural Decision Records (ADR)

| # | Title | Decision |
|---|---|---|
| ADR-001 | IST for Admin Analytics | All date grouping SQL conversions use `CONVERT_TZ` to `Asia/Kolkata`. |
| ADR-002 | Preserve Legacy HTML Pages | Cinematic vanilla HTML pages kept to maintain high-performance animations. |
| ADR-003 | In-Memory Rate Limiter | Both Express (`middleware/rateLimiter.js`) and Next.js (`src/lib/rate-limiter.ts`) rate limiters utilize a highly optimized, synchronous in-memory sliding-window backing store to eliminate latency and infrastructure overhead. |
| ADR-004 | Fail-Open Rate Limiting | Limiter errors fail open. Platform availability > perfect limiter coverage. |
| ADR-005 | PostHog vs. Sentry Separation | PostHog tracks behavior; Sentry tracks runtime exceptions. |
| ADR-006 | Email-Only Verification Gate | Only chat routes are gated by email verification to keep profile pages accessible. |
| ADR-007 | Token Hashing Strategy | SHA-256 hashing is enforced for verification and reset tokens in the DB. |
| ADR-008 | Razorpay Webhook Signatures | Verification must use crypto raw request verification to prevent signature spoofing. |
| ADR-009 | Double-Submit CSRF Guard | Custom cookie/header matching replaces deprecated packages for stateless CSRF mitigation. |
| ADR-010 | Subdomain Auth Coupling | Session tokens use apex domain cookie configurations to enable subdomain SSO. |
| ADR-011 | Rating Notifications Gate | Notifications trigger only for new ratings, avoiding notifications on edits or deletions. |
| ADR-012 | Salted IP Hash for Ratings | Ratings analytics events use SHA-256 salted hashes of visitor IPs with JWT_SECRET for anonymity. |


---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Supported development of the core architecture, real-time chat, security layers, and moderation modules.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Participating to build out community discovery features, invite/request boards, and advanced crew analytics.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

