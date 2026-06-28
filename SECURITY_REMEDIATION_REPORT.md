# SECURITY REMEDIATION REPORT

This document details the security vulnerabilities identified during the audit of the TAKE ONE – NEXUS repository and the fixes applied to resolve them.

| Alert ID | Severity | File | Line Number | Root Cause | Recommended Fix | Fix Applied |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SSRF-001** | High | `routes/community.js` | 346 | Dynamic construction of fetch URL from untrusted user input (`razorpay_payment_id`). | Validate URLs to ensure HTTPS protocol and reject all local/private/internal subnets. | Created a secure URL validator `utils/security/urlValidator.js` and sanitization checks for the dynamic ID parameter before construct. |
| **RATE-001** | Medium | `middleware/rateLimiter.js` | 1-121 | Custom sliding window rate limiter is not suitable for distributed/serverless environments (resets on container initialization). | Replace with `express-rate-limit` using a distributed store (e.g., Upstash Redis) with local fallback. | Re-implemented using `express-rate-limit` and a custom resilient `UpstashRedisStore` that falls back to memory. |
| **SQLI-001** | High | `routes/users.js` | 699 | String interpolation of limit and offset variables in SQL query. | Parameterize the query with placeholders (`?`). | Replaced string interpolation with parameterized arrays `[limit, offset]`. |
| **XSS-001** | Medium | `server.js` | 109 | Helmet is not configured to explicitly send XSS protection headers for legacy browsers. | Explicitly enable `xssFilter: true` in Helmet. | Configured `xssFilter: true` in Helmet options. |
