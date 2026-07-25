import Redis from 'ioredis';

let redis;

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, score } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  const parsedScore = parseInt(score, 10);
  if (isNaN(parsedScore)) {
    return res.status(400).json({ error: 'Invalid score' });
  }

  // Sanitize username and limit length
  const cleanUsername = username.trim().substring(0, 20);

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    // Initialize Redis lazily
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Add player and score to sorted set
    const result = await redis.zadd('leaderboard', parsedScore, cleanUsername);

    return res.status(200).json({ success: true, result });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
