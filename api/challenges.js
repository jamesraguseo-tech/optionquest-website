import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';

let redis;

async function getRedisClient(req, redisUrl) {
  if (req._mockRedis) return req._mockRedis;
  if (!redis) {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(redisUrl);
  }
  return redis;
}

/**
 * Default Week 2 & Evergreen Active Challenges served when Redis schedule is empty
 * or before initial administrative seeding.
 */
export const DEFAULT_ACTIVE_CHALLENGES = [
  {
    id: 'challenge_silicon_volatility_w2',
    title: 'Silicon Volatility Defense',
    description: 'Execute 2 disciplined semiconductor or index option trades risking ≤5% of portfolio during high IV',
    category: 'risk',
    progress_metric: 'disciplined_sizing',
    target: 2,
    xp_reward: 250,
    coin_reward: 300,
    active_from: '2026-01-01T00:00:00Z',
    active_until: '2027-12-31T23:59:59Z',
    priority: 1,
  },
  {
    id: 'challenge_lessons',
    title: 'Knowledge First',
    description: 'Complete 2 lessons in Learning Hub to sharpen quantitative edge',
    category: 'knowledge',
    progress_metric: 'lessons_completed',
    target: 2,
    xp_reward: 150,
    coin_reward: 200,
    active_from: '2026-01-01T00:00:00Z',
    active_until: '2027-12-31T23:59:59Z',
    priority: 2,
  },
  {
    id: 'challenge_risk_management',
    title: 'Risk Manager',
    description: 'Exit a losing position before -20% to cut downside early',
    category: 'risk',
    progress_metric: 'risk_managed',
    target: 1,
    xp_reward: 250,
    coin_reward: 300,
    active_from: '2026-01-01T00:00:00Z',
    active_until: '2027-12-31T23:59:59Z',
    priority: 3,
  },
];

export default async function handler(req, res) {
  // Security & CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl && !req._mockRedis) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    const client = await getRedisClient(req, redisUrl);

    // Rate Limiting: 60 requests per minute per IP
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimit(client, `challenges:${clientIp}`, 60, 60);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Vercel Edge CDN Caching: 1 hour fresh, 24 hours stale-while-revalidate
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');

    const nowMs = Date.now();
    const activeChallenges = [];

    // 1. Read multi-week schedule hash from Redis
    const rawSchedule = await client.hgetall('challenges:schedule');
    if (rawSchedule && typeof rawSchedule === 'object') {
      for (const jsonStr of Object.values(rawSchedule)) {
        try {
          const item = JSON.parse(jsonStr);
          const fromMs = item.active_from ? Date.parse(item.active_from) : 0;
          const untilMs = item.active_until ? Date.parse(item.active_until) : Number.MAX_SAFE_INTEGER;
          if (
            (isNaN(fromMs) || fromMs <= nowMs) &&
            (isNaN(untilMs) || untilMs >= nowMs)
          ) {
            activeChallenges.push(item);
          }
        } catch (_) {
          // Ignore malformed entry
        }
      }
    }

    // 2. Fallback to single active_challenge key if schedule hash had no active entries
    if (activeChallenges.length === 0) {
      const singleRaw = await client.get('active_challenge');
      if (singleRaw) {
        try {
          const parsed = JSON.parse(singleRaw);
          if (Array.isArray(parsed)) {
            activeChallenges.push(...parsed);
          } else if (parsed && typeof parsed === 'object') {
            activeChallenges.push(parsed);
          }
        } catch (_) {
          // Ignore malformed JSON
        }
      }
    }

    // 3. Sort active challenges by priority ascending
    activeChallenges.sort((a, b) => (Number(a.priority) || 99) - (Number(b.priority) || 99));

    const finalChallenges = activeChallenges.length > 0 ? activeChallenges : DEFAULT_ACTIVE_CHALLENGES;

    return res.status(200).json({
      success: true,
      challenges: finalChallenges,
    });
  } catch (err) {
    console.error('[Challenges API Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
