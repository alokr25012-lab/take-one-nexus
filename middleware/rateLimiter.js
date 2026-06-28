/**
 * middleware/rateLimiter.js
 *
 * Distributed Rate Limiting Middleware using express-rate-limit.
 * Custom store connects to Upstash Redis REST API, with fallback to local memory.
 * Maintains full backward compatibility with legacy custom rate limit calls.
 */

'use strict';

const rateLimit = require('express-rate-limit');

/**
 * Custom Upstash Redis rate limit store with resilient in-memory fallback.
 */
class UpstashRedisStore {
  /**
   * @param {string} url - Upstash Redis REST API URL
   * @param {string} token - Upstash Redis REST API Token
   * @param {string} prefix - Key prefix for Redis store
   * @param {number} windowMs - Rate limiting window size in milliseconds
   */
  constructor(url, token, prefix, windowMs) {
    this.url = url;
    this.token = token;
    this.prefix = prefix;
    this.windowMs = windowMs;
    this.memoryFallback = new Map();
  }

  /**
   * Increments hit count for key.
   * 
   * @param {string} key - Tracking key (e.g. IP address)
   * @returns {Promise<{totalHits: number, resetTime: Date}>}
   */
  async increment(key) {
    const redisKey = `rl:${this.prefix}:${key}`;
    
    if (this.url && this.token) {
      try {
        const res = await fetch(`${this.url}/pipeline`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify([
            ["INCR", redisKey],
            ["TTL", redisKey]
          ]),
          signal: AbortSignal.timeout(3000) // 3 seconds timeout
        });
        
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data) && !data[0].error && !data[1].error) {
            const totalHits = Number(data[0].result);
            let ttl = Number(data[1].result);
            
            // Set expiration if not already set (e.g. key was just created)
            if (ttl === -1) {
              const expireSec = Math.ceil(this.windowMs / 1000);
              await fetch(`${this.url}/expire/${redisKey}/${expireSec}`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.token}` },
                signal: AbortSignal.timeout(2000)
              });
              ttl = expireSec;
            }
            
            const resetTime = new Date(Date.now() + (ttl * 1000));
            return { totalHits, resetTime };
          }
        }
      } catch (err) {
        console.warn(`[RateLimiter] Upstash Redis call failed for ${redisKey}. Falling back to memory:`, err.message);
      }
    }
    
    // In-memory fallback
    const now = Date.now();
    let hits = this.memoryFallback.get(key) || [];
    
    // Evict timestamps outside the window range
    hits = hits.filter(t => now - t < this.windowMs);
    hits.push(now);
    
    this.memoryFallback.set(key, hits);
    
    const oldest = hits[0];
    const resetTime = new Date(oldest + this.windowMs);
    
    return {
      totalHits: hits.length,
      resetTime
    };
  }

  /**
   * Decrements hit count for key (optional interface requirement).
   * 
   * @param {string} key
   */
  async decrement(key) {
    const redisKey = `rl:${this.prefix}:${key}`;
    if (this.url && this.token) {
      try {
        await fetch(`${this.url}/decr/${redisKey}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` },
          signal: AbortSignal.timeout(1000)
        });
      } catch (e) {}
    }
    
    const hits = this.memoryFallback.get(key);
    if (hits && hits.length > 0) {
      hits.pop();
      this.memoryFallback.set(key, hits);
    }
  }

  /**
   * Resets hit count for key (optional interface requirement).
   * 
   * @param {string} key
   */
  async resetKey(key) {
    const redisKey = `rl:${this.prefix}:${key}`;
    if (this.url && this.token) {
      try {
        await fetch(`${this.url}/del/${redisKey}`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${this.token}` },
          signal: AbortSignal.timeout(1000)
        });
      } catch (e) {}
    }
    
    this.memoryFallback.delete(key);
  }
}

/**
 * Express sliding-window rate limit creator function.
 * Keep 100% exact API backward compatibility with legacy custom rate limit calls.
 * 
 * @param {object}   options
 * @param {number}   options.limit       - Max requests per window
 * @param {number}   options.windowMs    - Window duration in milliseconds
 * @param {string}   [options.keyPrefix] - Store key prefix (default: 'rl')
 * @param {function} [options.keyFn]     - Custom key generator function: (req) => string
 */
function createRateLimiter({ limit, windowMs, keyPrefix = 'rl', keyFn }) {
  const finalLimit = limit || 60;
  const finalWindowMs = windowMs || 60 * 1000;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  return rateLimit.rateLimit({
    windowMs: finalWindowMs,
    limit: finalLimit,
    standardHeaders: 'draft-7', // Send RateLimit-* headers
    legacyHeaders: true, // Send X-RateLimit-* headers
    validate: false,
    keyGenerator: (req) => {
      if (keyFn) return keyFn(req);
      const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip || 'unknown';
      return ip;
    },
    store: new UpstashRedisStore(url, token, keyPrefix, finalWindowMs),
    handler: (req, res, next, options) => {
      res.status(429).json({
        success: false,
        message: 'Too many requests. Please wait before trying again.'
      });
    }
  });
}

// Specialized Rate Limiters
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 20, // Max 20 auth attempts per 15 minutes
  keyPrefix: 'auth-limit'
});

const ratingLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30, // Max 30 ratings per 15 minutes
  keyPrefix: 'rating-limit'
});

const portfolioLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 50, // Max 50 portfolio operations per 15 minutes
  keyPrefix: 'portfolio-limit'
});

const uploadLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 10, // Max 10 file uploads per 15 minutes
  keyPrefix: 'upload-limit'
});

const communityLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 30, // Max 30 community modifications per 15 minutes
  keyPrefix: 'community-limit'
});

module.exports = {
  createRateLimiter,
  authLimiter,
  ratingLimiter,
  portfolioLimiter,
  uploadLimiter,
  communityLimiter
};