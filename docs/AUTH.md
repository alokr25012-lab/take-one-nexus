# 🔐 TAKE ONE Nexus — Authentication & Security Architecture

This document provides a comprehensive technical overview of the authentication, session sharing, and CSRF protection mechanisms designed for the TAKE ONE Nexus collaborative ecosystem.

---

## 🛰️ 1. Authentication Core (JWT)

TAKE ONE Nexus uses JSON Web Tokens (JWT) for stateless, secure user sessions. 

### Payload Structure
The JWT payload stores basic user identity and authorization scopes to minimize database lookups on authenticated routes:
```json
{
  "id": 1,
  "email": "aarushgupta289@gmail.com",
  "role": "Developer",
  "secondary_role": "admin",
  "email_verified": true,
  "iat": 1716800000,
  "exp": 1717664000
}
```

### Signature Verification
- In production, tokens are cryptographically signed using the `JWT_SECRET` environment variable (minimum 32 characters).
- If the token is modified or signed with a different key, verification throws a `JsonWebTokenError` and the session is rejected.
- Admin and Developer access is controlled exclusively through the `role` and
`secondary_role` fields in the JWT payload. These are populated from the
database at login and validated by middleware on every authenticated request.

---

## 🍪 2. Subdomain Session Cookie Sharing

The Administrative Console and Moderation platform are decoupled from the main website and hosted on independent subdomains:
- **Main App**: `takeone-nexus.net.in` (Apex)
- **Admin Command Center**: `admin.takeone-nexus.net.in` (Subdomain)
- **Scripts Moderation**: `scripts.takeone-nexus.net.in` (Subdomain)

### The Domain Attribute Mechanics
In order to prevent users from having to sign in multiple times when navigating between these platforms, the token cookie is shared across the entire apex domain:
- **Production Cookie Options**:
  ```javascript
  {
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    path: '/',
    maxAge: 864000000, // 10 days
    domain: '.takeone-nexus.net.in' // Prefix dot shares cookie with all subdomains
  }
  ```
- **Local Development Cookie Options**:
  On `localhost`, browsers reject cookies containing custom public domains (like `.takeone-nexus.net.in`) or configured with `SameSite: None` without active HTTPS connections. Therefore, the options dynamically adapt in development:
  ```javascript
  {
    httpOnly: true,
    secure: false, // Allows HTTP on localhost
    sameSite: 'Lax', // Lax is required for localhost cross-port cookie persistence
    path: '/'
  }
  ```

---

## 🛡️ 3. Stateless CSRF Protection

To prevent Cross-Site Request Forgery (CSRF) attacks, TAKE ONE Nexus employs a stateless **Double-Submit Cookie Pattern** globally on all state-changing API endpoints (POST, PUT, PATCH, DELETE).

### Mechanics of the Double-Submit Pattern
1. **CSRF Token Generation**:
   When the user loads the application, the frontend fetches a fresh CSRF token from the `/api/csrf-token` route. The Express server sets a cookie named `_csrf` containing the token secret and returns a JSON payload containing the token.
2. **Client Attachment**:
   On all mutating requests, the client reads the CSRF token from the JSON payload or page state and attaches it to the request header as `X-CSRF-Token`.
3. **Parity Check**:
   The `csrfProtection` middleware extracts the `_csrf` cookie and the `X-CSRF-Token` header. It compares them in constant-time. If they match, the request passes; otherwise, the server rejects it with a `403 Forbidden` error.

---

## 🖥️ 4. Safe Development Auth Debugging Logs

To help contributors quickly diagnose and resolve local cookie, CSRF, and routing issues without compromising production secrets, safe development-only logging is active on all authentication hooks.

### Sample Output Console Logs

- **Registration Attempts**:
  ```bash
  [AUTH_DEBUG] Registration attempt for email: creator@takeone.test
  [AUTH_DEBUG] ✅ Registration success: Created user creator@takeone.test (ID: 10)
  [AUTH_DEBUG] Cookie options: { httpOnly: true, secure: false, sameSite: 'Lax', path: '/' }
  ```

- **Login / Authentication**:
  ```bash
  [AUTH_DEBUG] Login attempt for email: admin@takeone.test
  [AUTH_DEBUG] ✅ Login success: Generated session token for user: admin@takeone.test (ID: 2)
  [AUTH_DEBUG] Cookie options: { httpOnly: true, secure: false, sameSite: 'Lax', path: '/' }
  ```

- **Mutating Requests (CSRF Validation)**:
  ```bash
  [CSRF_DEBUG] Incoming Request: POST /api/scripts
  [CSRF_DEBUG] CSRF Cookie Present: true
  [CSRF_DEBUG] CSRF Header (X-CSRF-Token) Present: true
  [CSRF_DEBUG] ✅ CSRF Validation Passed for POST /api/scripts
  ```

- **CSRF Validation Failures**:
  ```bash
  [CSRF_DEBUG] Incoming Request: PUT /api/users/profile
  [CSRF_DEBUG] CSRF Cookie Present: true
  [CSRF_DEBUG] CSRF Header (X-CSRF-Token) Present: false
  [CSRF_DEBUG] ❌ CSRF Validation Failed for PUT /api/users/profile
  [CSRF_DEBUG] Error details: invalid csrf token
  ```

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

