import Redis from 'ioredis';
import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';

let redis;

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
  if (!redisUrl) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Rate Limiting: 60 requests per minute per IP
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimit(redis, `leaderboard:${clientIp}`, 60, 60);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Fetch the top 100 players from the sorted set (high to low) - purely read-only
    const rawList = await redis.zrevrange('leaderboard', 0, 99, 'WITHSCORES');
    const formattedLeaderboard = [];
    const testPattern = /test_user|^test_|^testuser|^test\d+/i;

    // Parse flat array [username1, score1, username2, score2, ...] into objects
    let rank = 1;
    for (let i = 0; i < rawList.length; i += 2) {
      const username = rawList[i];
      const score = parseInt(rawList[i + 1], 10);

      // In-memory filter so test users never appear in the mobile app, without triggering write locks on GET
      if (testPattern.test(username)) {
        continue;
      }

      formattedLeaderboard.push({
        username,
        score: isNaN(score) ? 0 : score,
        rank: rank++,
      });
    }

    return res.status(200).json({ success: true, leaderboard: formattedLeaderboard });
  } catch (err) {
    console.error('[Leaderboard API Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
