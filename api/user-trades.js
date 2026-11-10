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

const MAX_PUBLIC_TRADES = 5;
const TRADES_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days

function sanitizeTrade(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const symbol = typeof raw.symbol === 'string'
    ? raw.symbol.trim().toUpperCase().replace(/[^A-Z0-9.^]/g, '').substring(0, 10)
    : '';
  if (!symbol) return null;

  const rawType = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : 'call';
  const type = rawType === 'put' ? 'put' : 'call';

  const strike = Number(raw.strike);
  if (!Number.isFinite(strike) || strike <= 0 || strike > 100000) return null;

  const entryPrice = Number(raw.entryPrice ?? raw.entry_price ?? 0);
  const exitPrice = Number(raw.exitPrice ?? raw.exit_price ?? 0);
  const pnl = Number(raw.pnl ?? 0);
  const pnlPercent = Number(raw.pnlPercent ?? raw.pnl_percent ?? 0);
  const portfolioRiskPercent = Number(raw.portfolioRiskPercent ?? raw.risk_percent ?? 2.5);

  if (
    !Number.isFinite(entryPrice) ||
    !Number.isFinite(exitPrice) ||
    !Number.isFinite(pnl) ||
    !Number.isFinite(pnlPercent) ||
    !Number.isFinite(portfolioRiskPercent)
  ) {
    return null;
  }

  const timestamp = typeof raw.timestamp === 'string' && !isNaN(Date.parse(raw.timestamp))
    ? new Date(raw.timestamp).toISOString()
    : new Date().toISOString();

  return {
    symbol,
    type,
    strike: Math.round(strike * 100) / 100,
    entryPrice: Math.round(Math.max(0, entryPrice) * 100) / 100,
    exitPrice: Math.round(Math.max(0, exitPrice) * 100) / 100,
    pnl: Math.round(pnl * 100) / 100,
    pnlPercent: Math.round(Math.max(-100, Math.min(10000, pnlPercent)) * 10) / 10,
    portfolioRiskPercent: Math.round(Math.max(0.1, Math.min(100, portfolioRiskPercent)) * 10) / 10,
    timestamp,
  };
}

export default async function handler(req, res) {
  // Security & CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl && !req._mockRedis) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    const client = await getRedisClient(req, redisUrl);
    const clientIp = getClientIp(req);

    // =========================================================================
    // GET /api/user-trades?username={username}
    // =========================================================================
    if (req.method === 'GET') {
      const rawUsername = req.query && req.query.username;
      if (!rawUsername || typeof rawUsername !== 'string' || rawUsername.trim().length === 0) {
        return res.status(400).json({ error: 'Invalid username query parameter' });
      }

      const cleanUsername = rawUsername.trim().substring(0, 20);
      const lowerName = cleanUsername.toLowerCase();

      const rateLimit = await checkRateLimit(client, `user-trades-get:${clientIp}`, 60, 60);
      if (!rateLimit.allowed) {
        res.setHeader('Retry-After', String(rateLimit.retryAfter));
        return res.status(429).json({ error: 'Too many requests. Please try again later.' });
      }

      res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');

      const storedJson = await client.get(`user:trades:${lowerName}`);
      let trades = [];
      if (storedJson) {
        try {
          const parsed = JSON.parse(storedJson);
          if (Array.isArray(parsed)) {
            trades = parsed.slice(0, MAX_PUBLIC_TRADES);
          }
        } catch (_) {
          trades = [];
        }
      }

      return res.status(200).json({
        success: true,
        username: cleanUsername,
        trades,
      });
    }

    // =========================================================================
    // POST /api/user-trades
    // =========================================================================
    const { username, deviceToken, trade, trades: incomingTrades } = req.body || {};

    if (!username || typeof username !== 'string' || username.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid username' });
    }

    if (!deviceToken || typeof deviceToken !== 'string' || deviceToken.trim().length === 0) {
      return res.status(400).json({ error: 'Invalid device token' });
    }

    const cleanUsername = username.trim().substring(0, 20);
    const lowerName = cleanUsername.toLowerCase();
    const cleanToken = deviceToken.trim();

    const rateLimit = await checkRateLimit(client, `user-trades-post:${clientIp}:${cleanToken}`, 30, 60);
    if (!rateLimit.allowed) {
      res.setHeader('Retry-After', String(rateLimit.retryAfter));
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // Verify device ownership of the username
    const registeredToken = await client.hget('registered_usernames', lowerName);
    if (!registeredToken) {
      return res.status(403).json({ error: 'Username must be claimed before publishing trades' });
    }
    if (registeredToken !== cleanToken) {
      return res.status(403).json({ error: 'Access denied: Device token mismatch' });
    }

    const candidates = Array.isArray(incomingTrades)
      ? incomingTrades
      : (trade ? [trade] : []);
    const sanitizedIncoming = candidates.map(sanitizeTrade).filter(Boolean);

    if (sanitizedIncoming.length === 0) {
      return res.status(400).json({ error: 'Invalid trade payload' });
    }

    const key = `user:trades:${lowerName}`;
    let existing = [];
    const existingRaw = await client.get(key);
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        if (Array.isArray(parsed)) existing = parsed;
      } catch (_) {
        existing = [];
      }
    }

    const merged = [...sanitizedIncoming, ...existing].slice(0, MAX_PUBLIC_TRADES);
    await client.set(key, JSON.stringify(merged), 'EX', TRADES_TTL_SECONDS);

    return res.status(200).json({
      success: true,
      trades: merged,
    });
  } catch (err) {
    console.error('[User Trades API Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
