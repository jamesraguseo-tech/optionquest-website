/**
 * Dual-key sliding window / fixed-window rate limiter using Redis.
 *
 * @param {import('ioredis').Redis} redisClient
 * @param {string} keyIdentifier - e.g. "submit-score:127.0.0.1:token123"
 * @param {number} limit - Maximum requests allowed in the window
 * @param {number} windowSeconds - Duration of window in seconds
 * @returns {Promise<{ allowed: boolean, remaining: number, retryAfter: number }>}
 */
export async function checkRateLimit(redisClient, keyIdentifier, limit = 30, windowSeconds = 60) {
  const rateLimitKey = `ratelimit:${keyIdentifier}`;

  try {
    const pipeline = redisClient.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.ttl(rateLimitKey);
    const results = await pipeline.exec();

    const currentCount = results[0][1];
    let ttl = results[1][1];

    if (ttl === -1 || currentCount === 1) {
      await redisClient.expire(rateLimitKey, windowSeconds);
      ttl = windowSeconds;
    }

    if (currentCount > limit) {
      return {
        allowed: false,
        remaining: 0,
        retryAfter: ttl > 0 ? ttl : windowSeconds,
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, limit - currentCount),
      retryAfter: 0,
    };
  } catch (err) {
    console.error('[RateLimit Error]', err);
    // Fail-open for transient redis rate-limit check errors to avoid taking down service
    return {
      allowed: true,
      remaining: 1,
      retryAfter: 0,
    };
  }
}

/**
 * Extracts client IP from Vercel / proxy headers.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
export function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || '127.0.0.1';
}
