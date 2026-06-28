# 📊 Analytics Privacy & Anonymization Documentation

## Overview

TAKE ONE Nexus is committed to protecting user privacy while using analytics and telemetry to improve platform performance, usability, and reliability. 

We utilize a multi-layered observability stack:
1. **Graphifyy Analytics**: For lightweight, privacy-friendly site telemetry.
2. **PostHog**: For consent-gated user experience and behavioral analysis.
3. **Sentry**: For backend runtime error diagnostics.

All metrics are collected in a way that minimizes exposure of personally identifiable information (PII) and prioritizes user privacy.

---

## Observability Privacy Matrix

| Tool | Purpose | Consent Required | Cookies | PII Handling |
| :--- | :--- | :---: | :---: | :--- |
| **Graphifyy** | General page visit count, device category distribution, and page speed index. | No | ❌ No | Fully anonymous. IP addresses are salted and hashed. |
| **PostHog** | Client-side user behavior, feature flags, and session replays. | Yes (GDPR Banner) | ✔️ Yes | Strict input masking on text elements. Password, token, and secret fields are stripped prior to transmission. |
| **Sentry** | Backend error capture, API routes, and DB exception monitoring. | No (Developer Diagnostic) | ❌ No | Logged exceptions scrub dynamic parameters. `beforeSend` interceptor filters authentication keys. |

---

## 🔒 PostHog & Sentry Safeguards

### 1. Consent Gate & Opt-Out
Client-side PostHog telemetry is completely disabled until a visitor interacts with the **GDPR Cookie Consent Banner** and selects "Accept All" or customizes "Analytics/Session Replay" permissions.
- Consent preferences are persisted locally in `localStorage` under `ton_cookie_consent`.
- Opting out blocks script injection and leaves the user's session fully private.

### 2. Input Masking & Session Replay Security
For users who opt-in to session replays:
- **Input Masking**: All input fields (`<input>`, `<textarea>`, `<select>`) are fully masked. Keystrokes are replaced with placeholder dots, and values are not visible in recordings.
- **PII Scrubbing**: Specific HTML elements containing personal data (e.g. email addresses, names) are tagged with `ph-no-capture` class to prevent them from being captured or sent to telemetry endpoints.

### 3. Sentry PII Scrubber Middleware
Backend exception telemetry runs a custom filtering hook (`beforeSend`) inside `src/lib/sentry.ts`. The script automatically parses the event request details and scrubs:
- Request headers (specifically `Cookie` and `Authorization`).
- Query parameters (specifically tokens, passwords, and verification hashes).
- POST request payloads containing credentials.

---

## ⚙️ Hash Truncation Strategy

The platform uses a truncated SHA-256 hash for visitor identification in anonymous telemetry:

- **Algorithm**: SHA-256 (Salted)
- **Truncation**: First 16 hexadecimal characters (64 bits)
- **Purpose**: Anonymize IP addresses while maintaining visitor uniqueness and preventing dictionary attacks
- **Implementation**: `crypto.createHash('sha256').update(String(ip) + process.env.JWT_SECRET).digest('hex').substring(0, 16)`

---

## 📅 Recommended Data Retention Periods

| Data Type | Retention Period | Rationale |
|-----------|-----------------|-----------|
| Raw analytics events (profile_view, project_engagement) | 90 days | Sufficient for trend analysis and debugging |
| Aggregated daily/weekly metrics | 1 year | Supports long-term product decisions |
| User-level analytics summaries | 1 year | Balances user insights with privacy |
| Performance metrics | 6 months | Operational monitoring window |

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.
