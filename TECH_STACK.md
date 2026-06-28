# 🛠️ TAKE ONE Nexus — Technology Stack

TAKE ONE Nexus is built on a modern, highly optimized hybrid web architecture designed to deliver cinematic visuals, real-time collaboration, and enterprise-grade security.

---

## 1. Core Architecture Layers

| Layer | Technology | Version | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend UI** | **React** / **Next.js** (App Router) | React v19 / Next.js v16 | Handles client-side view rendering, routing, dynamic user profiles, leaderboard display, and real-time interactive dashboards. |
| **Styling** | **Tailwind CSS** / **Vanilla CSS** | Tailwind v3 | Drives the dark-mode cinematic "Director-style" cyberpunk aesthetic with high-performance animations, grain overlays, and custom cursors. |
| **API Backend** | **Node.js** / **Express.js** | Express v4 | Serves as the high-throughput REST API backend (`/api/*`), processing database queries, webhooks, and rate-limiting rules. |
| **Database** | **MySQL** | Optimized for TiDB Cloud | Central data store containing schemas for users, profiles, chats, scripts, payment status, and task credits. |
| **ORM** | **Prisma ORM** | v5 | Provides type-safe database schemas and database access queries across both Next.js route handlers and the Express backend. |

---

## 2. Real-Time & Transactional Services

### 🛰️ Pusher (Real-Time WebSockets)
* **Purpose**: Bidirectional event propagation for real-time collaboration.
* **Features**:
  * Real-time peer-to-peer and group chat messaging.
  * Live status changes (e.g. `SCRIPT_MODERATED` and `SCRIPT_DELETED` broadcasts).
  * Real-time notification delivery and credit updates.
  * Instant leaderboard refreshes.

### ✉️ Resend Email Service & Nodemailer
* **Purpose**: Transactional email notifications and identity verification.
* **Features**:
  * Automated email verification on user signup.
  * Cooldown-restricted resend requests.
  * Secure password recovery flows.
  * Live moderator feedback emails on script approval/rejection.

### 💳 Razorpay Payment Gateway
* **Purpose**: Monetization and verification gateway for script writers.
* **Features**:
  * Secure backend order creation.
  * Signature verification on raw webhook buffers.
  * Automatic transition of draft scripts to published states upon verification.

---

## 3. Observability, Telemetry & Diagnostics

### 📊 Graphifyy Analytics
* **Purpose**: Privacy-friendly, lightweight web analytics.
* **Features**:
  * Tracks user visits and visual engagement patterns.
  * Traffic insights and source distribution mapping.
  * Core Web Vitals and performance monitoring.
  * Completely self-contained, cookies-free client-side footprint.

### 🦔 PostHog Analytics
* **Purpose**: Behavioral analysis and product intelligence.
* **Features**:
  * GDPR-compliant client-side telemetry (gated by cookie consent).
  * Session replay recording with strict input masking (strips passwords, tokens, and PII).
  * Feature flag evaluations.
  * Local Indian Standard Time (IST) timestamp adjustments.

### 🛡️ Sentry Error Monitoring
* **Purpose**: Infrastructure exception monitoring.
* **Features**:
  * Backend API route failure capture.
  * Database query exceptions and transaction failures.
  * PII filter hooks (`beforeSend`) that scrub passwords, JWT tokens, and API keys before transmission.

---

## 4. Security Infrastructure

* **JWT (JSON Web Tokens)**: Stateless authentication utilizing cookie storage.
* **Double-Submit CSRF Pattern**: Parity validation between the `_csrf` cookie and `X-CSRF-Token` headers.
* **Granular Rate Limiters**: In-memory sliding-window limiters restricting registration, authentication, issue creation, and payment requests to prevent abuse.
* **Helmet Middleware**: Enforces browser-level headers (CSP, X-Frame-Options: DENY, and nosniff).
