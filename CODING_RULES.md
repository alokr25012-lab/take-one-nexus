# Engineering Standards & Coding Rules

> Professional guidelines for contributors writing code for TAKE ONE Nexus. Consistency is our priority.

---

## 1. Naming Conventions

### Files and Directories
- **kebab-case** for all file/directory names: `global-chat-fab.js`, `profile-page.css`.
- **PascalCase** for React components: `IssueReportModal.tsx`.
- **camelCase** for plain JS utilities: `api.js`.

### Code Variables
- **camelCase** for variables and functions: `fetchScripts()`, `currentUser`.
- **PascalCase** for React components and TS Interfaces: `ProfileCard`, `UserRole`.
- **SCREAMING_SNAKE_CASE** for constants: `TAKE_ONE_ROLES`.

### Database & API
- **snake_case** for Database tables and columns: `collaboration_requests`, `avatar_url`.
- **kebab-case** for API route paths: `/api/users/me`.

---

## 2. UI Consistency & Cinematic Aesthetic

TAKE ONE Nexus uses a highly specific **cinematic dark UI**.
- **Color Palette:** Strictly adhere to the `void` and `machine` theme variables defined in our CSS. Use neon accents sparingly for interactive elements only.
- **CSS Variables:** Never hardcode colors or fonts. Always use the predefined CSS custom properties (e.g., `var(--color-neon)`).
- **Glassmorphism:** Use `backdrop-filter: blur` for modals and elevated layers.
- **Animations:** Prefer CSS keyframe animations (`transform`, `opacity`) over heavy JS-driven animations.

---

## 3. Component Structure & React Patterns

### Next.js (App Router)
- **Server First:** Default to React Server Components (RSC). Only use `"use client"` when DOM interactivity or state (`useState`, `useEffect`) is strictly required.
- **TypeScript:** Type all props using Interfaces. Never use `any`.
- **Modularity:** If a component is used in more than one route, place it in `src/components/`. If it is unique to a page, co-locate it within that route's directory.

### Vanilla JS (Static HTML Pages)
- **Scope Isolation:** Wrap all logic in `DOMContentLoaded` listeners or IIFEs to prevent global scope pollution.
- **DOM Guarding:** Always check if a DOM element exists before attaching event listeners (e.g., `if (btn) btn.addEventListener(...)`).

---

## 4. API & Database Patterns

### Prisma ORM
- **No Raw SQL:** Always use Prisma Client for database queries to ensure type safety.
- **Select Specifics:** Avoid fetching entire rows if only specific fields are needed. Use Prisma's `select` object.
- **Pagination:** All list endpoints must implement cursor-based pagination (or limit/offset) to prevent massive payloads.

### Error Handling
- **Backend:** Wrap all Express route logic in `try/catch` blocks and pass errors to the global error handler via `next(err)`.
- **Frontend:** Always provide a graceful fallback UI. Never expose raw stack traces to the user. Log errors to the console in development, but silence them in production.
- **Validation:** Use **Zod** for schema validation on all incoming API requests.

---

## 5. Responsive & Accessibility Rules

### Responsive Design
- **Mobile First:** Base CSS targets mobile devices. Use `min-width` media queries to scale up.
- **Fluid Layouts:** Utilize CSS Grid and Flexbox. Do not use fixed pixel heights for text containers.
- **Touch Targets:** All interactive elements must be a minimum of `44x44px` to accommodate touch devices.

### Accessibility (a11y)
- **Keyboard Navigation:** Ensure all custom UI elements are keyboard accessible using `tabindex` and event listeners for `Enter`/`Space`.
- **Semantic HTML:** Use proper tags (`<button>`, `<nav>`, `<main>`) rather than generic `<div>` elements attached with click handlers.
- **Alt Text:** All `<img>` tags must include descriptive `alt` text. Use `alt=""` for purely decorative images.

---

## 6. Documentation Standards

- **Inline Comments:** Comment the *why*, not the *what*. If the code is complex, explain the business logic driving it.
- **JSDoc:** Use JSDoc comments for complex utility functions to provide context and param typing.
- **Changelog:** Update the `FEATURE_LOG.md` when introducing significant features, database migrations, or architectural shifts.

---

## 7. Environment & Infrastructure Constraints

### 🚫 STRICT NO-NEW-ENV / NO-INFRASTRUCTURE POLICY
To keep the codebase maintainable and prevent security/cost drift:
- **No New Environment Variables**: Contributors are **strictly forbidden** from introducing or demanding new environment variables. All environment variables must already be present in `.env.example`.
- **No External Backing Stores/Infrastructure**: Contributors are not allowed to integrate external databases, caching stores (such as Redis, Upstash, Memcached, etc.), or external cloud APIs requiring additional tokens or credentials.
- **In-Memory & Self-Contained Only**: Any rate limiting, state tracking, or caching logic must be fully self-contained in-memory (e.g., using sliding-window `Map` objects) or leverage the central MySQL database.

---
*By following these rules, we ensure TAKE ONE Nexus remains a robust, maintainable, and professional source-available project.*
## Critical Fix Rules

- Never trust a frontend payment success state. Verify Razorpay signatures on the backend before creating scripts.
- Never expose unpaid scripts in public reads, moderation queues, or leaderboard-derived counts.
- Never authorize destructive moderation actions from client-side role checks alone.
- Log script deletion as `SCRIPT_DELETED` in `moderation_logs`.

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.

