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

  const { username, deviceToken } = req.body;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid username' });
  }

  if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.trim().length === 0) {
    return res.status(400).json({ error: 'Invalid device token' });
  }

  // Sanitize and limit username length
  const cleanUsername = username.trim().substring(0, 20);
  const cleanToken = deviceToken.trim();

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
    // Initialize Redis lazily
    if (!redis) {
      redis = new Redis(redisUrl);
    }

    // Check if the username is already registered to a device token
    const registeredToken = await redis.hget('registered_usernames', cleanUsername.toLowerCase());

    if (!registeredToken) {
      // Username is available, claim it!
      // Store under lowercase to ensure case-insensitive uniqueness, but save the display format
      await redis.hset('registered_usernames', cleanUsername.toLowerCase(), cleanToken);
      // We also store a mapping of the exact display case for display rendering
      await redis.hset('username_display_cases', cleanUsername.toLowerCase(), cleanUsername);
      
      return res.status(200).json({ success: true, claimed: true });
    }

    if (registeredToken === cleanToken) {
      // Username is already claimed by this device, allowed to keep it
      return res.status(200).json({ success: true, claimed: true, message: 'Already owned by this device' });
    }

    // Username is claimed by a different device token
    return res.status(409).json({ success: false, error: 'Username already taken' });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
