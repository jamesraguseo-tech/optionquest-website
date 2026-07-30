import Redis from 'ioredis';

let redis;

export default async function handler(req, res) {
  // Enable CORS
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
    // Initialize Redis lazily
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Fetch the top 100 players from the sorted set (high to low)
    const rawList = await redis.zrevrange('leaderboard', 0, 99, 'WITHSCORES');
    const formattedLeaderboard = [];

    // Parse flat array [username1, score1, username2, score2, ...] into objects
    let rank = 1;
    for (let i = 0; i < rawList.length; i += 2) {
      const username = rawList[i];
      const score = parseInt(rawList[i + 1], 10);
      
      // Filter out and clean test users (e.g. test_user_123, test_123, testuser)
      const isTestUser = /test_user|^test_|^testuser|^test\d+/i.test(username);
      if (isTestUser) {
        await redis.zrem('leaderboard', username);
        await redis.hdel('registered_usernames', username.toLowerCase());
        await redis.hdel('username_display_cases', username.toLowerCase());
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
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
