import Redis from 'ioredis';
import { checkRateLimit, getClientIp } from '../lib/rate-limit.js';

let redis;

export default async function handler(req, res) {
  // Security & CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username, score, deviceToken } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  const parsedScore = parseInt(score, 10);
  // Score integrity: must be valid integer within realistic gameplay bounds (0 to 50,000,000)
  if (isNaN(parsedScore) || parsedScore < 0 || parsedScore > 50000000) {
    return res.status(400).json({ error: 'Invalid score value' });
  }

  if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid device token' });
  }

  // Sanitize values
  const cleanUsername = username.trim().substring(0, 20);
  const cleanToken = deviceToken.trim();

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Rate Limiting: 30 submissions per minute per IP and deviceToken
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimit(redis, `submit-score:${clientIp}:${cleanToken}`, 30, 60);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // 1. Verify device ownership of the username (case-insensitive check)
    const registeredToken = await redis.hget('registered_usernames', cleanUsername.toLowerCase());

    if (!registeredToken) {
      return res.status(403).json({ error: 'Username must be claimed before submitting scores' });
    }

    if (registeredToken !== cleanToken) {
      return res.status(403).json({ error: 'Access denied: Device token mismatch' });
    }

    // 2. Fetch the correct case-sensitive display name registered
    const displayUsername = await redis.hget('username_display_cases', cleanUsername.toLowerCase()) || cleanUsername;

    // 3. Add player and score to sorted set
    const result = await redis.zadd('leaderboard', parsedScore, displayUsername);

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('[Submit Score API Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
