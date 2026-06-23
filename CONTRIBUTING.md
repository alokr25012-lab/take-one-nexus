# 🤝 Contributing to TAKE ONE Nexus

First off, thank you for considering contributing to TAKE ONE Nexus! It's people like you that make this ecosystem such a great tool for filmmakers and creators.

If this project has been useful to you, consider giving it a ⭐ on GitHub — it helps others discover the project and keeps us motivated!

We welcome contributions of all kinds: bug fixes, feature additions, documentation improvements, and design tweaks.

---

## 🌐 Open Source & Community Programs

TAKE ONE – NEXUS is actively participating in community development initiatives:
*   **NSoC'26 (Nexus Spring of Code 2026)**: Core development phase focusing on real-time channels, security middleware, and admin portals.
*   **GSSoC'26 (GirlScript Summer of Code 2026)**: Expansion phase focusing on communities, roles, invite/request flows, and responsive UI hardening.

---

## 📋 GSSoC'26 / NSoC'26 Contribution Workflow

To contribute during these programs, please adhere to the following workflow:

### 1. Issue Claiming & Assignment
*   **Search Before Creating**: Before opening a new issue, search the existing open and closed issues and discussions to see if the topic has already been reported or discussed.
*   **Duplicate Issue Policy**: Duplicate issues will be closed to keep tracking clean. If your issue is a duplicate, please add your feedback or vote directly to the existing issue rather than opening a new one.
*   **Issue Form Workflow**: New issues must be opened using our structured GitHub Issue Forms (Bug Report, Feature Request, or Security Report). Blank issues are disabled.
*   **Real-Time Duplicate Detection**: While writing your issue's Title or Description inside the GitHub issue creation flow, GitHub will automatically scan and surface a "Potential duplicate" list above the submit button. Check this list to verify if your issue is already documented.
*   **Request Assignment**: Comment on the issue requesting assignment. Please do not start working on an issue until a maintainer has officially assigned it to you.
*   **Limits**: To ensure fairness, contributors will only be assigned one issue at a time. Once a PR for your assigned issue is merged or enters final review, you may request another.
*   **Idle Timeout**: If there is no activity, draft PR, or update on an assigned issue for **3 days**, the issue may be unassigned to keep it available for other community members.

### 2. Forking & Local Setup
1.  **Fork the repository** on GitHub.
2.  **Clone your fork** locally:
    ```bash
    git clone https://github.com/YOUR_USERNAME/take-one-nexus.git
    cd take-one-nexus
    ```
3.  **Add the upstream remote** to sync changes:
    ```bash
    git remote add upstream https://github.com/alokr25012-lab/take-one-nexus.git
    ```
4.  **Install dependencies**:
    ```bash
    npm install
    ```
5.  **Configure Environment**: Copy `.env.example` to `.env` and set up the variables. Refer to [SETUP.md](docs/SETUP.md) for database seeding steps.

### 3. Branching Conventions
Create a new branch from `main` using descriptive names:
*   `feature/gssoc-issueId-description` (For features)
*   `bugfix/gssoc-issueId-description` (For bug fixes)
*   `docs/gssoc-issueId-description` (For documentation)

Example:
```bash
git checkout -b feature/gssoc-144-add-community-invitations
```

---

## 💻 Coding & Security Standards

We maintain a high standard for code quality to ensure scalability and maintainability.

> [!CAUTION]
> ### 🚫 Environment Variables & Infrastructure Constraints (STRICT POLICY)
> *   **No New Environment Variables**: Contributors are **strictly forbidden** from introducing or requiring new environment variables in the project. All PRs containing unauthorized environment additions will be immediately rejected.
> *   **No External Backing Stores/Infrastructure**: You are not allowed to introduce external databases, caching stores (like Redis, Upstash, etc.), third-party backing services, or new library integrations that require cloud credentials/tokens.
> *   **Strict Self-Containment**: All newly added features, rate-limiters, or storage mechanisms must rely solely on the existing MySQL/TiDB database structure (managed via Prisma) or run entirely in-memory.

### 🛡️ Security Guidelines (Mandatory)
*   **CSRF Token Handling**: All state-changing API endpoints must check for CSRF token parity. If adding new POST/PUT/PATCH/DELETE endpoints, ensure they go through the `verifyCsrfToken` middleware in `server.js`.
*   **Session Cookie Security**: In production, auth cookies enforce `secure: true`, `domain: '.takeone-nexus.net.in'` and `sameSite: 'None'`. In development, the cookie domain is omitted, and `sameSite: 'Lax'` is used to ensure compatibility with browsers on `localhost`.
*   **Database Interactivity**: Under no circumstances should you dynamically concatenate strings for SQL commands. All database interactions must use parameterized queries (via `?` placeholder inputs or Prisma).
*   **Payment Operations**: Razorpay Webhook handlers must use signature-verification on raw buffers before executing state transitions.
*   **Credit Ledgers**: Operations that modify user credits must be performed inside a database transaction block to ensure atomic safety.

### 🎨 Visual & Frontend Code
*   **Typography & Styling**: We use Vanilla CSS for static pages and Tailwind/CSS Modules for Next.js components. Adhere strictly to the cinematic tokens (e.g., `var(--neon)`, `var(--cyber-bg)`).
*   **Error Handling**: API endpoints must catch exceptions using `try-catch` blocks and return consistent JSON structures: `{ success: boolean, message: string, data?: any }`.
*   **Linting**: Before committing, ensure your code passes our linting rules:
    ```bash
    npm run lint
    ```

---

## 📝 Commit Message Conventions

We follow [Conventional Commits](https://www.conventionalcommits.org/):
*   `feat:` A new feature
*   `fix:` A bug fix
*   `docs:` Documentation only changes
*   `style:` Formatting changes (white-space, formatting, missing semi-colons, etc)
*   `refactor:` Code restructuring
*   `test:` Adding or updating tests
*   `chore:` Maintenance tasks

**Example Commit:**
`feat: add group member promotion and demotion controls (#144)`

---

## 🔄 Pull Request Guidelines

1.  **Keep it focused**: A PR should ideally do one thing. If you're fixing a bug and adding a feature, open two separate PRs.
2.  **Sync with upstream**: Before submitting, ensure your branch is up-to-date with `upstream/main`:
    ```bash
    git fetch upstream
    git rebase upstream/main
    ```
3.  **Write a clear description**: Detail what the PR does, why it's needed, and how to test it. Link the issue using `Closes #123`.
4.  **Reference GSSoC'26 / NSoC'26**: Add appropriate labels or reference the program in your PR description.
5.  **Pass Checks**: Ensure your PR passes all automated checks (linting, build process) before requesting a review.

---

## ⚖️ Contribution License Agreement

By contributing to TAKE ONE Nexus (including submitting pull requests, issues, feedback, or code), you agree and acknowledge that:
*   Your contributions may be incorporated into the project and remain under the project's source-available license.
*   You grant TAKE ONE Nexus a perpetual, irrevocable, worldwide, royalty-free, non-exclusive, sub-licensable license to incorporate, modify, distribute, and utilize your contribution within the project.
*   You represent that you are the sole author of your contribution and have the legal right to submit it.