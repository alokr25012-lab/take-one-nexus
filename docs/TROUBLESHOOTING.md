# Troubleshooting Guide

## API Route "Not Found" Errors

### Issue
Getting errors like "Route POST /api/auth/verify-email not found" even though the route exists in the codebase.

### Symptoms
- API routes return 404 errors
- Routes work in production but not in development
- Recently pulled changes from upstream

### Root Cause
Next.js development server's route cache becomes stale and doesn't recognize new or updated API routes.

### Solution

**Quick Fix:**
1. Stop the development server (Ctrl+C)
2. Delete the `.next` cache folder
3. Restart the development server

```bash
# Stop the server first (Ctrl+C)

# Delete cache (Unix/Mac/Linux)
rm -rf .next

# Delete cache (Windows PowerShell)
Remove-Item -Recurse -Force .next

# Restart server
npm run dev
```

**Alternative - Hard Refresh:**
```bash
npm run build
npm run dev
```

### Prevention
- Regularly clear `.next` cache during active development
- Restart dev server after pulling changes from upstream
- Use `npm run build` to catch compilation errors early

---

## Rate Limit Errors During Testing

### Issue
Getting "Too many requests" errors when testing authentication features.

### Symptoms
- 429 HTTP status codes
- "Too many requests. Please wait before trying again." message
- Unable to test login/register/email flows

### Root Cause
Rate limiting is configured to prevent abuse, with strict limits:
- Login: 5 attempts per 15 minutes
- Register: 3 accounts per hour per IP
- Resend verification: 3 attempts per hour

### Solution for Local Testing

**Temporary:** Comment out rate limiters in development:

1. For Next.js API routes, modify `src/lib/rate-limit-config.ts`:
   ```typescript
   // Temporarily increase limits for testing
   login: { limit: 1000, windowMs: 15 * 60 * 1000 },
   ```

2. For Legacy Express routes, modify `routes/users.js`:
   ```javascript
   // Temporarily increase limits for testing
   const loginLimiter = createRateLimiter({
     limit: 1000,
     windowMs: 15 * 60 * 1000,
   });
   ```

**⚠️ CRITICAL:** Always restore production limits before committing:
```bash
git checkout src/lib/rate-limit-config.ts routes/users.js
```

### Better Solution
Wait for the rate limit window to expire, or restart both servers to clear in-memory rate limit counters.

---

## Database Schema Sync Issues

### Issue
Prisma errors about missing columns or tables.

### Symptoms
- "The column `tablename.columnname` does not exist"
- "Unknown column" errors
- Database schema mismatch errors

### Root Cause
Local database schema is out of sync with Prisma schema after pulling updates.

### Solution

**Sync database:**
```bash
npx prisma db push
```

**Or run migrations:**
```bash
npx prisma migrate dev
```

**Regenerate Prisma Client:**
```bash
npx prisma generate
```

---

## Email Not Sending in Development

### Issue
Email verification/password reset emails not being received.

### Symptoms
- Success message shown but no email arrives
- Resend API key configured but emails don't send

### Root Cause
- Production email domain `takeone-nexus.net.in` not verified in Resend
- Resend free tier only allows `onboarding@resend.dev` in development

### Solution for Local Testing

Use Resend's default email for development:
```typescript
// In email sending code, use:
from: 'Your App <onboarding@resend.dev>'
```

**Check Resend Dashboard:**
1. Visit https://resend.com/emails
2. Check email delivery logs
3. Verify API key is valid

**⚠️ Remember:** Restore production email before deploying:
```typescript
from: 'TAKE ONE <noreply@takeone-nexus.net.in>'
```

---

## Port Already in Use

### Issue
Cannot start dev server - port 3000 or 5001 already in use.

### Symptoms
- "EADDRINUSE: address already in use :::3000"
- Server fails to start

### Solution

**Find and kill the process (Windows):**
```bash
netstat -ano | findstr :3000
taskkill /PID <PID> /F
```

**Find and kill the process (Unix/Mac/Linux):**
```bash
lsof -ti:3000 | xargs kill -9
```

**Or change port:**
```bash
# Next.js
PORT=3001 npm run dev

# Legacy Express
PORT=5002 npm run legacy:dev
```

---

## General Debugging Tips

1. **Check console logs** - Both browser and server terminal
2. **Clear browser cache** - Or use incognito mode
3. **Check environment variables** - Ensure `.env` file is properly configured
4. **Verify dependencies** - Run `npm install` if you pulled new changes
5. **Check database connection** - Ensure MySQL is running and accessible
6. **Review error stack traces** - They often point to the exact issue

---

## Getting Help

If issues persist:
1. Check existing GitHub issues
2. Review the project documentation in `/docs`
3. Ask in project discussions or Discord
4. Include error messages, logs, and steps to reproduce

---

**Last Updated:** June 2026

---

## 🌐 Community & Collaboration Programs

TAKE ONE – NEXUS is developed as an open-source collaboration platform and participates in community-driven development initiatives:
* **NSoC'26 (Nexus Spring of Code 2026)**: Focuses on core modules, telemetry, and platform security.
* **GSSoC'26 (GirlScript Summer of Code 2026)**: Focuses on communities, roles, invite/request boards, and responsive layouts.

Contributors are encouraged to explore issues, submit pull requests, improve documentation, and help build tools for filmmakers and creative teams under the project's source-available license.
