/**
 * src/lib/rate-limiter.ts
 *
 * Next.js API route rate limiter.
 * Lightweight in-memory sliding-window rate limiter — no external dependencies.
 *
 * Degrades gracefully — never blocks on an internal error.
 * PUBLIC API — all three functions preserved exactly:
 *   checkRateLimit(key, options)  → RateLimitResult
 *   buildRateLimitKey(prefix, id) → string
 *   getClientIP(req)              → string
 */

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

// Minimal structural type instead of NextRequest — preserves compatibility
// with plain Request objects and test mocks.
type RequestLike = {
  headers: {
    get(name: string): string | null;
  };
};

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 10 minutes to prevent memory leaks
const cleanupTimer = clearInterval(window.__interval); window.__interval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (now - entry.windowStart > 2 * 60 * 60 * 1000) {
      store.delete(key);
    }
  }
}, 10 * 60 * 1000);

cleanupTimer.unref?.();

// ── TYPES ──

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter: number; // seconds
  limit: number;
}

// ── PRESERVED HELPER FUNCTIONS ──
// Do not remove or change signatures — existing Next.js routes call these.

/**
 * Extract the real client IP from a request.
 * Uses RequestLike instead of NextRequest to stay compatible with
 * plain Request objects and test mocks.
 */
export function getClientIP(req: RequestLike): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

/**
 * Build a namespaced rate limit store key.
 * Supports any number of namespace parameters for backwards compatibility.
 * e.g., buildRateLimitKey('login', '192.168.1.1') → 'login:192.168.1.1'
 */
export function buildRateLimitKey(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts].filter(Boolean).join(':');
}

// ── CORE FUNCTION ──

/**
 * Check and increment the rate limit for a given key synchronously.
 *
 * Usage pattern:
 *   const key = buildRateLimitKey('login', getClientIP(req));
 *   const result = checkRateLimit(key, { limit: 5, windowMs: 900000 });
 *
 * @param key     - Fully-formed key from buildRateLimitKey()
 * @param options - limit and windowMs
 */
export function checkRateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  try {
    const now = Date.now();
    const existing = store.get(key);

    if (!existing || now - existing.windowStart >= windowMs) {
      // New window
      store.set(key, { count: 1, windowStart: now });
      return {
        success: true,
        remaining: limit - 1,
        resetAt: new Date(now + windowMs),
        retryAfter: 0,
        limit
      };
    }

    if (existing.count >= limit) {
      // Rate limited
      const resetAt = new Date(existing.windowStart + windowMs);
      const retryAfter = Math.ceil((existing.windowStart + windowMs - now) / 1000);
      return {
        success: false,
        remaining: 0,
        resetAt,
        retryAfter,
        limit
      };
    }

    // Within limit — increment
    existing.count += 1;
    store.set(key, existing);
    return {
      success: true,
      remaining: Math.max(0, limit - existing.count),
      resetAt: new Date(existing.windowStart + windowMs),
      retryAfter: 0,
      limit
    };
  } catch (err) {
    // ADR-004: fail open — store errors must not block legitimate traffic
    console.error('[RateLimiter] Store error:', err instanceof Error ? err.message : err);
    return {
      success: true,
      remaining: limit,
      resetAt: new Date(Date.now() + 60000),
      retryAfter: 0,
      limit
    };
  }
}