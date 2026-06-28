# 📖 TAKE ONE NEXUS DEVELOPER WIKI

Welcome to the **TAKE ONE Nexus Developer Wiki**. This comprehensive knowledge base catalogs the platform architecture, production systems, and newly added UX modules. 

TAKE ONE Nexus is engineered for high-performance, real-time collaboration among independent student filmmakers. Below is the navigation index for exploring the platform internals.

---

## 🧭 Wiki Directory

### 1. [Brand Clarity & Visual Hierarchy](HERO_CLARITY_SYSTEM.md)
*   **Plain-English Messaging**: The strategic rationale behind *“Find your film crew. Share your scripts. Make your movie.”*

## Critical Operations

- Script submission: draft first, backend Razorpay verification second, script creation last.
- Script deletion: backend-authorized, audited as `SCRIPT_DELETED`, and cleans references/assets where possible.
- Tasks: admin-created definitions use `tasks`; user review state uses `task_submissions`; approval creates credit activity and updates the leaderboard.
*   **Dual-Audience Entry**: Breakdown of split CTAs tailored specifically to *Creators* vs *Crew operatives*.
*   **Cyberpunk Visual Guidelines**: Typography scales, neon tailwinds, HSL custom contrast, and cinematic layout parameters.

### 2. [Self-Onboarding & Interactive Walkthroughs](ONBOARDING_TOUR.md)
*   **Interactive HUD Guide**: Step-by-step interactive tooltip guide powered by vanilla spotlight mapping.
*   **Replay System**: Bottom-right HUD FAB allowing users to retrigger synchronizations on demand.
*   **Multi-Step Registration Wizard**: Detailed walkthrough of the account creation modal split into:
    1. *Account Settings*
    2. *Pathway Selection* (Creator/Crew cards & dynamic specialty filter)
    3. *College/Geographic details*

### 3. [Screenplay Submission Wizard](SUBMISSION_WIZARD.md)
*   **Logline Builder**: Interactive visual prompt that outputs unified, cinematic pitches.
*   **Crew Planner**: Tap-to-toggle multi-select role planning chips.
*   **Payload Coordination**: Clean dynamic schema integration that feeds the Express and Prisma backend.

### 4. [System Architecture & Hybrid Operations](HYBRID_ARCHITECTURE.md)
*   **Dual-Server Core**: Next.js App Router and Express API proxy coordinating over Vercel.
*   **Folder Structure**: Unified codebase organization and asset pipelines.
*   **Prisma Database & ORM**: Migration strategies and live pooling on TiDB.

### 5. [Security & Production Hardening](SECURITY_HARDENING.md)
*   **Content Security Policy (CSP)**: Secure HTTP headers preventing XSS and clickjacking.
*   **Email Automation**: Transactional welcome and verification sequences powered by Resend.
*   **Rate Limiting**: IP-based security gates safeguarding dynamic endpoints.

---

## 🛠️ Local Onboarding & Bootstrapping

To set up the development environment, configure the `.env` file and execute the dual dev processes:

```bash
# Terminal 1: Next.js Frontend
npm run dev

# Terminal 2: Express API Backend
npm run legacy:dev
```

For detailed setup details, consult the primary [README.md](../readme.md#🚀-getting-started).

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

---

<div align="center">
  <p><i>TAKE ONE Nexus Wiki • Designed for the Cinematic Future</i></p>
</div>

