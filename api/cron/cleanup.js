import Redis from 'ioredis';
import { requireCronAuth } from '../../lib/cron-auth.js';

let redis;

export default async function handler(req, res) {
  // Only allow POST or GET from scheduled cron
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Enforce timing-safe Bearer CRON_SECRET authentication
  const auth = requireCronAuth(req);
  if (!auth.success) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Fetch top 500 records to inspect for test accounts
    const rawList = await redis.zrevrange('leaderboard', 0, 499, 'WITHSCORES');
    let prunedCount = 0;
    const testPattern = /test_user|^test_|^testuser|^test\d+/i;

    for (let i = 0; i < rawList.length; i += 2) {
      const username = rawList[i];
      if (testPattern.test(username)) {
        await redis.zrem('leaderboard', username);
        await redis.hdel('registered_usernames', username.toLowerCase());
        await redis.hdel('username_display_cases', username.toLowerCase());
        prunedCount++;
      }
    }

    return res.status(200).json({
      success: true,
      job: 'leaderboard-cleanup',
      prunedCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[Cron Cleanup Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
