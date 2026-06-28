<div align="center">
  <img src="https://via.placeholder.com/1000x300/0a0a0a/ffffff?text=TAKE+ONE+NEXUS" alt="TAKE ONE Nexus Banner" />

  <h1>🎬 TAKE ONE NEXUS</h1>

  <p><strong>TAKE ONE – NEXUS is an open-source collaboration platform built for filmmakers, creators, photographers, editors, writers, and production teams to connect, collaborate, and build projects together.</strong></p>

  <p>
    <a href="https://take-one-nexus.vercel.app"><b>Explore the Live Platform</b></a> •
    <a href="#-getting-started"><b>Getting Started</b></a> •
    <a href="CONTRIBUTING.md"><b>Contribute</b></a>
  </p>

  <p>
    <img alt="Version" src="https://img.shields.io/badge/version-2.2.0-blue.svg?cacheSeconds=2592000" />
    <img alt="License: Source-Available" src="https://img.shields.io/badge/License-Source--Available-red.svg" />
    <img alt="Production Ready" src="https://img.shields.io/badge/PRODUCTION_READY-FF4D1A?style=flat&logo=vercel" />
    <img alt="NSoC 2026" src="https://img.shields.io/badge/NSoC-2026-blue?style=flat" />
    <img alt="GSSoC 2026" src="https://img.shields.io/badge/GSSoC-2026-orange?style=flat" />
  </p>
</div>

---

## 📽️ The Vision

> **Nexus [nɛksəs]:** A connection or series of connections linking two or more things.

TAKE ONE Nexus is the definitive digital ecosystem for the next generation of filmmakers, screenwriters, and creative technocrats. 

**The Problem**: Student filmmakers and independent creatives often struggle to find dedicated, skilled crew members for their passion projects. Traditional networking is fragmented.

**The Solution**: A platform designed with a cinematic "Director-style" aesthetic that acts as a secure, real-time hub for showcasing portfolios, discovering talent based on creative roles, and forming production crews. 

---

## ⚡ Core Features

*   **👥 Communities**: Form, discover, and join specialized filmmaking groups and production units.
*   **📂 Crew Directory & Profiles**: Comprehensive index of creators sorted by roles (Directors, DPs, Editors, Writers, Photographers) with live cinematic portfolios serving as digital reels.
*   **👑 Role System & Management**: Fine-grained community roles (Owner, Admin, Member) with administrative workflows (member promotion, demotion, removal).
*   **📩 Invite & Request System**: Send join invitations or manage incoming join requests with dedicated approval dashboards.
*   **🏆 Live Leaderboard**: Real-time community ranking system based on creative engagement and verified creator achievements.
*   **⭐ Creator Rating System**: Interactive rating system for creators with submission, editing, and deletion capabilities, notifying creators on new ratings and feeding analytics tracking.
*   **🎬 Projects & Script Sharing**: Share scripts securely with built-in PDF iframe preview and options for monetization.
*   **🛡️ Authentication & Verification**: Secure stateless JWT sessions coupled with a full signup-to-verification email flow. Verified creators earn a neon (✦) verified badge.
*   **🛰️ Real-Time Chat & Notifications**: Real-time communication powered by Pusher. Direct messaging, group chats, live typing, and instant project notifications.
*   **📊 Observability & Analytics**: Integrated Graphifyy Analytics, PostHog telemetry (GDPR compliant), and Sentry error tracking for monitoring system health and engagement.
*   **✉️ Email Services**: Resend-powered automated onboarding, verification links, and script moderation reviews.
*   **💳 Payment Gateway**: Secure backend-verified Razorpay payment verification gating public script publication.
*   **🖥️ Admin Command Center**: Elevated dashboard for system telemetry, script moderation queues, and user triage.

---

## 📸 Screenshots

| Dashboard / Feed | Cinematic Profile |
| :---: | :---: |
| <img src="https://via.placeholder.com/500x300/111/eee?text=Project+Feed" alt="Feed" /> | <img src="https://via.placeholder.com/500x300/111/eee?text=Cinematic+Profile" alt="Profile" /> |

| Real-Time Chat | Leaderboard |
| :---: | :---: |
| <img src="https://via.placeholder.com/500x300/111/eee?text=Real-Time+Chat" alt="Chat" /> | <img src="https://via.placeholder.com/500x300/111/eee?text=Global+Leaderboard" alt="Leaderboard" /> |

*(Note: Replace placeholders with actual product screenshots prior to launch)*

---

## 🛠️ Tech Stack

This project is built using a modern, scalable hybrid architecture.

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 16 (App Router), Vanilla HTML/CSS (Static UI), React 19 |
| **Backend** | Node.js, Express.js |
| **Database** | MySQL (optimized for TiDB Cloud) |
| **ORM** | Prisma ORM |
| **Real-time** | Pusher (WebSockets) |
| **Authentication** | Stateless JWT stored in secure HTTP-only cookies |
| **Mailing** | Resend API & Nodemailer |
| **Analytics & Telemetry** | **Graphifyy** (Privacy-friendly), **PostHog** (User experience telemetry) |
| **Error Monitoring** | **Sentry** (Backend exceptions) |
| **Payments** | Razorpay (Signature-verified) |
| **Deployment** | Vercel (Hybrid Serverless & Static) |

For details, refer to [TECH_STACK.md](TECH_STACK.md).

---

## 🏗️ Architecture Overview

TAKE ONE Nexus utilizes a **dual-server architecture** running side-by-side on Vercel:
- **Next.js App (`src/app/`):** Handles dynamic authenticated routes (e.g., `/profile`, `/chat`, `/admin`), PostHog analytics, Sentry monitoring, and Graphifyy integration.
- **Express Server (`server.js`):** Acts as the API layer (`/api/*`), processes complex SQL queries securely, handles rate limiting, and serves high-performance static HTML files (`public/*.htm`).

### Subdomain Strategy
The Administrative Moderation Console is decoupled and hosted on the `admin` subdomain:
- **Main App**: `takeone-nexus.net.in` (Apex)
- **Admin Portal**: `admin.takeone-nexus.net.in` (Subdomain)
- **Shared Session**: Auth cookies share a common apex domain configuration: `domain: '.takeone-nexus.net.in'`. Users with the appropriate `secondary_role` permissions (e.g. `Admin`) can navigate to the admin console without re-authenticating.

For details, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

## 🚀 Getting Started

Follow these instructions to set up the project locally.

### Prerequisites

- **Node.js**: v18+
- **Database**: MySQL / TiDB instance
- **Pusher**: Account for real-time WebSockets
- **Resend**: API key for transactional emails
- **Graphifyy**: Analytics tracking key (optional)
- **PostHog**: API key for local analytics tracking (optional)
- **Sentry**: DSN for error monitoring (optional)
- **Git**: For version control

### 1. Clone the repository

```bash
git clone https://github.com/alokr25012-lab/take-one-nexus.git
cd take-one-nexus
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Variables Setup

Create a `.env` file in the root directory based on `.env.example`:

```env
# Database
DATABASE_URL="mysql://user:password@host:port/database"

# Authentication
JWT_SECRET="your_secure_secret_min_32_chars"

# Real-time Chat (Pusher)
PUSHER_APP_ID="your_app_id"
PUSHER_SECRET="your_secret"
NEXT_PUBLIC_PUSHER_KEY="your_key"
NEXT_PUBLIC_PUSHER_CLUSTER="your_cluster"

# Email Automation (Resend)
RESEND_API_KEY="re_your_key"

# Observability (PostHog & Sentry)
NEXT_PUBLIC_POSTHOG_KEY="phc_your_key"
NEXT_PUBLIC_POSTHOG_HOST="https://eu.i.posthog.com"
NEXT_PUBLIC_SENTRY_DSN="https://your_dsn@sentry.io/project"

# Local Development API Proxy
LEGACY_API_ORIGIN="http://127.0.0.1:5001"
```

### 4. Database Setup

Initialize your database schema using Prisma:

```bash
npx prisma generate
npx prisma db push
```

Alternatively, you can initialize and seed the raw database tables and test accounts (password for all: `password123`) using our dedicated scripts:

```bash
# Create database schema tables
npm run db:init

# Seed the database with creative profiles and sample scripts
npm run db:seed
```

### 5. Start Local Development

Because of the hybrid architecture, run the Next.js dev server (which proxies API requests to Express):

```bash
npm run dev
```

In a separate terminal, run the Express backend:

```bash
npm run legacy:dev
```

The platform should now be running at `http://localhost:3000`.

---

## 🚢 Production Deployment

TAKE ONE Nexus is optimized for deployment on **Vercel**.

1. Connect your GitHub repository to Vercel.
2. Configure the environment variables in the Vercel Dashboard.
3. Vercel will use the `vercel.json` file to handle complex routing between Next.js and the Express backend automatically.
4. The build command is pre-configured to `npm run build` which runs `prisma generate && next build`.

---

## 🌐 Open Source Programs

TAKE ONE – NEXUS was developed as an open-source collaboration platform and has been supported by the following community programs:

*   **NSoC'26 (Nexus Spring of Code 2026)**: Project developed under the NSoC'26 timeline to build the foundation of creative and cinematic collaboration tooling.
*   **GSSoC'26 (GirlScript Summer of Code 2026)**: Participating in GSSoC'26 to expand the community modules, onboarding systems, and collaborative production capabilities.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

---

## ⚖️ Licensing & Usage

* The source code is publicly visible for community contributions, issue reporting, and project improvement.
* Copyright remains with Take One Nexus.
* Commercial use, redistribution, hosting of modified versions, and creation of competing services are prohibited without written permission.

For full licensing terms, please refer to [LICENSE.md](LICENSE.md).

---

## 👥 Maintainers & Credits

Maintainership and Production of **Aarush Gupta** and **Alok Rawat**.
All Rights Reserved.
