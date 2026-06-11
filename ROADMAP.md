# 🗺️ Feature Roadmap

Welcome to the TAKE ONE Nexus Roadmap! This document outlines our strategic vision for the future of the platform. We are building a cinematic ecosystem, and these features represent the next leap in connecting filmmakers, crew members, and screenwriters.

---
# 🗺️ Feature Roadmap

Welcome to the TAKE ONE Nexus Roadmap! This document outlines our strategic vision for the future of the platform. We are building a cinematic ecosystem, and these features represent the next leap in connecting filmmakers, crew members, and screenwriters.

---

## 📑 Table of Contents

- [🟢 Phase 1: Foundation](#-phase-1-foundation-completed)
- [🟡 Phase 2: Production Hardening & Decoupling](#-phase-2-production-hardening--decoupling-completed)
- [🔵 Phase 3: The AI Production Board](#-phase-3-the-ai-production-board-upcoming)
- [🟣 Phase 4: Expansion & Ecosystem](#-phase-4-expansion--ecosystem)
- [🌐 Open Source Programs](#-open-source-programs)

---

## 🟢 Phase 1: Foundation (Completed)
- [x] Basic user registration and profile creation
- [x] Script uploading and showcase repository
- [x] Direct peer-to-peer chat system
- [x] Real-time global issue reporting
- [x] Core cinematic UI framework and design language

## 🟡 Phase 2: Production Hardening & Decoupling (Completed)
- [x] **Credits Economy System**: Users earn credits for uploading scripts and engaging with the community.
- [x] **Global Leaderboard**: Ranking users based on activity and peer reviews.
- [x] **Real-time Synchronization**: Pusher implementation for live chat, task updates, and notifications.
- [x] **Admin Telemetry Dashboard**: Complete command center for tracking platform metrics.
- [x] **Production Security Suite**: Stateless double-submit CSRF headers, rate limiting, and RBAC to achieve A-grade security.
- [x] **Observability**: PostHog telemetry and Sentry error tracking integrated.
- [x] **Cinematic Automation**: Resend integration for transactional emails.
- [x] **Verified Account Badge**: Neon ✦ badge displayed across surfaces for creators with verified email credentials.
- [x] **Script Moderation Pipeline**: Admin-only approval status tracking, automated rejection emails, and Pusher real-time events.
- [x] **Issue Admin Controls**: Issues now support `priority`, `assigned_admin`, and `resolved_at` for full triage lifecycle management.
- [x] **Admin Subdomain Decoupling**: Decoupled Next.js admin dashboard running on `admin.takeone-nexus.net.in` utilizing cookie apex domain sharing (`domain: '.takeone-nexus.net.in'`).
- [x] **Payment Integration**: Strict Razorpay signature verification on the backend to gate public script uploads.

## 🔵 Phase 3: The AI Production Board (Upcoming)
- [ ] **AI-Powered Crew Matching**: Algorithmic suggestions connecting directors with the ideal crew members.
- [ ] **Interactive Storyboards**: Built-in collaborative storyboarding tools where multiple users can sketch in real time.
- [ ] **Call Sheet Generator**: Automated dynamic call sheets synced with users' registered email addresses.
- [ ] **Advanced Portfolio Analytics**: Creators can see exactly who viewed their scripts and profiles.

## 🟣 Phase 4: Expansion & Ecosystem
- [ ] **Native Mobile App**: Porting the Next.js/React architecture to React Native for iOS and Android.
- [ ] **Freelance Escrow Integration**: Safe, integrated payment gateways for freelance crew members.
- [ ] **Film Festival Integration**: Direct submission API links to global film festivals.
- [ ] **Hardware Synchronization**: Integrating with digital clapperboards and on-set devices.

---

## 🌐 Open Source Programs

TAKE ONE Nexus is actively developed as an open-source filmmaking collaboration platform and participates in community-driven open-source initiatives including NSoC'26.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams.

