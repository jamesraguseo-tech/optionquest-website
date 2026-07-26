import Redis from 'ioredis';

let redis;

export default async function handler(req, res) {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // 1. Fetch entire registered usernames hash
    const registeredUsernames = await redis.hgetall('registered_usernames');

    // 2. Fetch entire display cases hash
    const displayCases = await redis.hgetall('username_display_cases');

    // 3. Fetch entire leaderboard sorted set with scores
    const leaderboardRaw = await redis.zrevrange('leaderboard', 0, -1, 'WITHSCORES');
    const leaderboard = [];
    for (let i = 0; i < leaderboardRaw.length; i += 2) {
      leaderboard.push({
        username: leaderboardRaw[i],
        score: parseInt(leaderboardRaw[i + 1], 10),
      });
    }

    return res.status(200).json({
      success: true,
      registeredUsernames,
      displayCases,
      leaderboard,
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
