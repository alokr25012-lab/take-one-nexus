# 👑 TAKE ONE Nexus — Admin Panel Guide

The Administrative Moderation Console (`admin.takeone-nexus.net.in`) is an isolated panel dedicated to platform managers, moderators, and developers. It enables live system triage, task definition creation, and script moderation.

---

## 1. Access Control (RBAC)

Access is strictly protected by a multi-tiered security check on both the frontend and the Express routing layer:
1. **Primary Role**: The user must have a role classification of `Admin` or `Developer` within their user record.
2. **Secondary Role**: The system validates the `secondary_role` parameter inside the user's JSON Web Token (JWT).
3. **Session Verification**: The `requireAdmin` and `requireSecondaryRole(['admin'])` middlewares gate all administrative routes. If a user tries to access `/admin` without these values, they are redirected to `/`.

---

## 2. Shared Authentication Loop

To prevent authentication loops between the main application and the admin console:
1. **Cookie apex configuration**: The token cookie is generated with `domain: '.takeone-nexus.net.in'` in production.
2. **Session continuity**: Because the cookie is accessible by subdomains, visiting `admin.takeone-nexus.net.in` checks the cookie, decrypts the JWT, validates the `secondary_role` payload field, and logs the administrator in.
3. **Logout synchronization**: The logout endpoint (`POST /api/users/logout`) clears the cookie with the same domain option, logging the user out from both environments.

---

## 3. Moderator Tasks & Nexus Credits

Moderators can direct and incentivize creative actions on the platform by creating tasks:
- **Task definitions**: Managed via `POST /api/tasks/admin/definitions`.
- **Reviewing submissions**: When users submit proof of completed work, admins approve or reject the submission via `/api/tasks/admin/submissions/:id/approve`.
- **Credit Allocation**: Approving a task inserts a new credit transaction record, increases the creator's `credits` count, and triggers a real-time leaderboard update.

---

## 4. Troubleshooting REDIRECT Loops

If an administrator is getting kicked back to `/`:
1. Ensure the administrator account has its `secondary_role` set to `'admin'` or `'moderator'` in the database.
2. Ensure the JWT payload contains `secondary_role` (older tokens created before version 2.0.0 will not contain this field and need a fresh login).
3. Verify that the client is transmitting the `token` cookie. In local testing, ensure that you are using `localhost` for both servers, or correct proxy ports.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

