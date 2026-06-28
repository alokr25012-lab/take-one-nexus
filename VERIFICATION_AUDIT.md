# Verification Audit & Guide | TAKE ONE Nexus

This document defines user verification data flow, API endpoints, and frontend rendering rules to guarantee consistent state visualization.

## 1. Database Schema (Source of Truth)
The user table stores verification status in the `email_verified` column.
- **SQL Column**: `email_verified` (represented as `TINYINT(1)` or `BOOLEAN`).
- **Prisma Schema**: `email_verified Boolean @default(false)`
- **Dev Environment Bypass**: In non-production environments, newly registered users default to `email_verified = true` (or `1`) via the registration query to simplify developer workflows:
  ```js
  const emailVerifiedVal = isProd ? 0 : 1;
  ```

## 2. API Data Layer
API endpoints that serve user profiles, search results, or leaderboard standings must explicitly format the database `email_verified` column to a Javascript boolean value before sending the payload.

### Monitored Endpoints
- **GET `/api/users/me`** (defined in `routes/users.js`): Maps `email_verified: userRows[0].email_verified === 1 || userRows[0].email_verified === true`.
- **GET `/api/users/search`** (defined in `routes/users.js`): Maps `email_verified: r.email_verified === 1 || r.email_verified === true`.
- **GET `/api/users/leaderboard`** (defined in `routes/users.js`): Maps `email_verified: r.email_verified === 1 || r.email_verified === true`.
- **GET `/api/users/public/:id`** (defined in `routes/users.js`): Selects `email_verified` and maps it to a strict boolean.
- **GET `/api/ratings/leaderboard`** (defined in `routes/ratings.js`): Maps `email_verified: r.email_verified === 1 || r.email_verified === true`.

## 3. UI Component Render Guards
Frontend components must use strict boolean check logic `=== true` rather than truthy/falsy evaluation to render verified badges, avoiding problems with unmapped numeric/undefined values.

### Monitored Visual Badges
- **Leaderboard Rankings** (`LeaderboardClient.tsx`):
  ```tsx
  {user.email_verified === true && (
    <span className="verified-badge-inline" title="Verified Creator">...</span>
  )}
  ```
- **Profile Header** (`src/app/profile/page.tsx`):
  ```tsx
  {user.email_verified === true && (
    <span className="verified-badge-inline" title="Verified Creator">...</span>
  )}
  ```
- **Community Chat Invites** (`src/app/chat/page.tsx`):
  ```tsx
  {user.email_verified === true && (
    <span title="Verified User" className="verified-badge">✓</span>
  )}
  ```
- **Crew Search Directory** (`public/scripts/pages/crew.js`):
  ```js
  const verifiedBadge = (person.email_verified === true || person.email_verified === 1) ? '...' : '';
  ```
