# 🚀 TAKE ONE Nexus — Deployment Guide

TAKE ONE Nexus uses a hybrid dual-server model running seamlessly on Vercel. This document guides you through preparing, configuring, and executing a deployment to production.

---

## 1. Prerequisites

Before deploying, ensure you have:
1. A **Vercel account** connected to your GitHub profile.
2. A **TiDB Cloud (or MySQL)** instance accessible from the internet.
3. A **Resend** account for transactional email processing.
4. A **Pusher** subscription for real-time WebSockets.
5. A **Razorpay** merchant account for payment processing.

---

## 2. Vercel Configuration (`vercel.json`)

Vercel automatically provisions routing rules using the `vercel.json` file in the root directory. Ensure it is structured to delegate API routes correctly:

```json
{
  "version": 2,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/api/server" }
  ]
}
```

This guarantees that all `/api/*` endpoints map directly to the Express server (running as a Serverless function), while Next.js routes handle client-side rendering.

---

## 3. Subdomain Cookie Configuration

The platform hosts its primary interface on the apex domain (`takeone-nexus.net.in`) and the administrative panel on the `admin` subdomain (`admin.takeone-nexus.net.in`).

To enable Single Sign-On (SSO):
1. The Express login route sets the `token` cookie.
2. Under `production` (`process.env.NODE_ENV === 'production'`), cookies are configured with `domain: '.takeone-nexus.net.in'`.
3. This allows the Next.js admin app on the subdomain to securely read the same `token` cookie and bypass repeated logins.

---

## 4. Environment Variables Checklist

Configure these variables inside your Vercel Dashboard for the deployment environment:

| Variable | Scope | Description |
|---|---|---|
| `DATABASE_URL` | Global | MySQL connection string: `mysql://user:pass@host:port/dbname` |
| `JWT_SECRET` | Global | Minimum 32-character string to sign user session tokens |
| `NEXTAUTH_SECRET` | Admin | Session encryption secret for Next.js auth middleware |
| `RESEND_API_KEY` | Express | API key to trigger onboarding and verification emails |
| `PUSHER_APP_ID` | Global | Pusher real-time configuration ID |
| `PUSHER_SECRET` | Global | Pusher real-time secret key |
| `NEXT_PUBLIC_PUSHER_KEY` | Global | Pusher public API key |
| `NEXT_PUBLIC_PUSHER_CLUSTER` | Global | Pusher region cluster |
| `RAZORPAY_KEY_ID` | Express | Razorpay Key ID |
| `RAZORPAY_KEY_SECRET` | Express | Razorpay Key Secret |

---

## 5. Deployment Checklist

To execute a clean release:
1. **Sync Schemas**: Run migrations on your target database:
   ```bash
   npx prisma db push --accept-data-loss
   ```
2. **Build Verification**: Run a local build test to catch compilation errors early:
   ```bash
   npm run build
   ```
3. **Trigger Deploy**: Push your commits to `main`. Vercel automatically detects changes, builds assets, and spins up serverless endpoints.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

