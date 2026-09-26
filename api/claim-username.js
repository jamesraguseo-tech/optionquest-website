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

  const { username, deviceToken } = req.body || {};

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid device token' });
  }

  // Sanitize and limit username length
  const cleanUsername = username.trim().substring(0, 20);
  const cleanToken = deviceToken.trim();
  const lowerName = cleanUsername.toLowerCase();

  // Validate username format (no spaces, only alphanumeric and underscores)
  const usernameRegex = /^[a-zA-Z0-9_]+$/;
  if (!usernameRegex.test(cleanUsername)) {
    return res.status(400).json({ error: 'Username must contain only letters, numbers, and underscores' });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Rate Limiting: 10 claim requests per 5 minutes per IP and per deviceToken
    const clientIp = getClientIp(req);
    const rateLimit = await checkRateLimit(redis, `claim-username:${clientIp}:${cleanToken}`, 10, 300);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Atomic claim check using HSETNX to prevent TOCTOU race conditions
    const claimedNew = await redis.hsetnx('registered_usernames', lowerName, cleanToken);

    if (claimedNew === 1) {
      // Successfully and atomically claimed!
      // Cleanup previous usernames owned by this device using O(1) device index
      const deviceIndexKey = `device_usernames:${cleanToken}`;
      const previousUsernames = await redis.smembers(deviceIndexKey);

      for (const oldLowerName of previousUsernames) {
        if (oldLowerName !== lowerName) {
          await redis.hdel('registered_usernames', oldLowerName);
          const oldDisplay = await redis.hget('username_display_cases', oldLowerName);
          if (oldDisplay) {
            await redis.zrem('leaderboard', oldDisplay);
            await redis.hdel('username_display_cases', oldLowerName);
          }
          await redis.zrem('leaderboard', oldLowerName);
          await redis.srem(deviceIndexKey, oldLowerName);
        }
      }

      // Add new username to device index and save display casing
      await redis.sadd(deviceIndexKey, lowerName);
      await redis.hset('username_display_cases', lowerName, cleanUsername);

      return res.status(200).json({ success: true, claimed: true });
    }

    // Already exists in hash: verify if already owned by this device token
    const registeredToken = await redis.hget('registered_usernames', lowerName);
    if (registeredToken === cleanToken) {
      await redis.hset('username_display_cases', lowerName, cleanUsername);
      await redis.sadd(`device_usernames:${cleanToken}`, lowerName);
      return res.status(200).json({ success: true, claimed: true, message: 'Already owned by this device' });
    }

    // Username claimed by a different device
    return res.status(409).json({ success: false, error: 'Username already taken' });
  } catch (err) {
    console.error('[Claim Username API Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
