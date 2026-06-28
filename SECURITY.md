# 🛡️ Security Policy

At TAKE ONE Nexus, the security of our filmmakers' intellectual property (scripts) and personal data is our highest priority. We take security vulnerabilities very seriously and appreciate the efforts of security researchers and our community in keeping our platform safe.

## 🟢 Supported Versions

We currently provide security updates and patches for the following versions of our platform:

| Version | Supported          |
| ------- | ------------------ |
| v2.1.x  | :white_check_mark: |
| v2.0.x  | :white_check_mark: |
| v1.x.x  | :x:                |

*(Note: Since we operate as a live SaaS platform, users always interact with the latest production version).*

## 🛑 Reporting a Vulnerability

If you discover a security vulnerability, we kindly ask that you do **not** report it via public GitHub issues or public forums. Instead, please follow our responsible disclosure process:

1. **Email the maintainer** at: `aarushgupta289@gmail.com`.
2. **Include detailed information**: Provide a thorough description of the vulnerability, the environment where it was discovered, and steps to reproduce it.
3. **Wait for confirmation**: We will acknowledge receipt of your vulnerability report within 24 hours.

We will work diligently to validate and fix the vulnerability. Once resolved, we will notify you and may publicly acknowledge your contribution (with your permission).

---

## 🔒 Security Architecture & Best Practices

To maintain a secure ecosystem, we adhere to the following security architectures:

### 1. Cross-Site Request Forgery (CSRF) Protection
We implement a stateless **Double-Submit Cookie Pattern** globally on all state-changing API routes (POST, PUT, PATCH, DELETE).
- On every response, the server sets a JS-readable cookie `csrf_token` with `SameSite: strict` (and `Secure` in production).
- The client-side (Next.js/admin panel) reads this token from the cookie and must include it in the `X-CSRF-Token` request header.
- The server checks if the header matches the cookie in constant-time to block unauthorized cross-site requests.
- **Local Dev Exception**: In local development (`NODE_ENV !== 'production'`), the `secure` cookie flag is disabled to support requests made on unencrypted `http://localhost`.
- Razorpay Webhooks and GET/OPTIONS routes are exempt from CSRF validation.

### 2. Authentication & Subdomain Session Sharing
- Session validation uses JSON Web Tokens (JWT) signed with a robust key (`JWT_SECRET`).
- Authentication cookies are configured with `httpOnly: true`, `secure: true` (in production), and `sameSite` set conditionally (`None` in production for cross-subdomain sharing; `Lax` in development for localhost support).
- **Subdomain Sharing**: In production, the session cookie is configured with `domain: '.takeone-nexus.net.in'`. This allows a user logged in on the apex domain to access elevated panels on the admin subdomain (`admin.takeone-nexus.net.in`) seamlessly without re-authenticating. Locally, the domain attribute is omitted to support port-based testing on localhost.
- `secondary_role` permissions (such as `admin` and `moderator`) are packed directly into the JWT payload during login, resolving route redirect loops.

### 3. Distributed & Granular Rate Limiting
Endpoint-specific rate limiters are applied on both the Next.js API router and Express middleware:
- **Distributed Architecture**: Rate limit counters are tracked using a distributed sliding window in production using Upstash Redis over REST. If Upstash is unconfigured or unreachable, the system gracefully falls back to a highly optimized local in-memory sliding log.
- **Authentication**: Auth operations (login, register, forgot/reset password) are strictly limited to 20 attempts per 15 minutes globally, with additional local limits (e.g. max 5 login attempts per 15 minutes).
- **Payments & Communities**: Order creation, verification, and community operations are restricted to 30 requests per 15 minutes.
- **Ratings & Portfolios**: Ratings modification is capped at 30 requests per 15 minutes, and portfolio modifications are capped at 50 requests per 15 minutes.
- **Uploads**: Avatar and media uploads are limited to 10 uploads per 15 minutes.

### 4. Input Sanitization, SSRF, & Parameterization
- **SSRF Mitigation**: Outbound request destinations (such as Razorpay payment verification) are strictly gated via a URL validation utility (`utils/security/urlValidator.js`). It restricts all requests to HTTPS protocol, blocks localhost/loopbacks, and rejects Class A/B/C private subnets, link-local addresses, and IPv4-mapped IPv6 subnets.
- **XSS Prevention**: All requests pass through a global middleware that automatically cleans and sanitizes `req.body`, `req.query`, and `req.params` against malicious HTML injection using the `xss` utility. Helmet headers are configured with `xssFilter: true` to enforce client-side defense-in-depth.
- **SQL Injection**: Parameterized SQL queries with placeholder `?` inputs are strictly enforced across the entire backend. All queries (including LIMIT and OFFSET bounds) are parameterized to prevent input injection.
- **Object Schema Validation**: Critical routes use `express-validator` schema chains to validate payloads before entering controller logic.

### 5. Multi-Platform Ingestion Security
- Telemetry, logging, and bug reporting modals run validation schemas to prevent abuse.
- Administrative triage and moderation updates are restricted to verified accounts possessing the `Admin` or elevated `secondary_role` privileges.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Supported development of the core security architecture, double-submit CSRF, and JWT authorization rules.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Participating to build secure member management boards and invite/request validations.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.
