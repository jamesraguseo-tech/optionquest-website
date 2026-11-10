import { requireCronAuth } from '../../lib/cron-auth.js';

let redis;

async function getRedisClient(req, redisUrl) {
  if (req._mockRedis) return req._mockRedis;
  if (!redis) {
    const { default: Redis } = await import('ioredis');
    redis = new Redis(redisUrl);
  }
  return redis;
}

const ALLOWED_CATEGORIES = new Set(['process', 'risk', 'knowledge', 'performance']);
const ALLOWED_METRICS = new Set([
  'disciplined_sizing',
  'risk_managed',
  'trades_executed',
  'lessons_completed',
  'spreads_traded',
  'profit_target_taken',
]);

function sanitizeChallenge(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const id = typeof raw.id === 'string' ? raw.id.trim().substring(0, 64) : '';
  const title = typeof raw.title === 'string' ? raw.title.trim().substring(0, 80) : '';
  const description = typeof raw.description === 'string' ? raw.description.trim().substring(0, 240) : '';

  if (!id || !title || !description) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;

  const category = ALLOWED_CATEGORIES.has(String(raw.category).toLowerCase())
    ? String(raw.category).toLowerCase()
    : 'risk';
  const progressMetric = ALLOWED_METRICS.has(String(raw.progress_metric))
    ? String(raw.progress_metric)
    : 'disciplined_sizing';

  const target = Math.max(1, Math.min(100, parseInt(raw.target, 10) || 2));
  const xpReward = Math.max(10, Math.min(10000, parseInt(raw.xp_reward ?? raw.xpReward, 10) || 200));
  const coinReward = Math.max(10, Math.min(10000, parseInt(raw.coin_reward ?? raw.coinReward, 10) || 250));
  const priority = Math.max(1, Math.min(100, parseInt(raw.priority, 10) || 1));

  const nowIso = new Date().toISOString();
  const sevenDaysIso = new Date(Date.now() + 7 * 86400 * 1000).toISOString();

  const activeFrom = typeof raw.active_from === 'string' && !isNaN(Date.parse(raw.active_from))
    ? new Date(raw.active_from).toISOString()
    : nowIso;
  const activeUntil = typeof raw.active_until === 'string' && !isNaN(Date.parse(raw.active_until))
    ? new Date(raw.active_until).toISOString()
    : sevenDaysIso;

  return {
    id,
    title,
    description,
    category,
    progress_metric: progressMetric,
    target,
    xp_reward: xpReward,
    coin_reward: coinReward,
    active_from: activeFrom,
    active_until: activeUntil,
    priority,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Enforce timing-safe Bearer CRON_SECRET authorization
  const auth = requireCronAuth(req);
  if (!auth.success) {
    return res.status(auth.status || 401).json({ error: auth.error });
  }

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl && !req._mockRedis) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  const body = req.body || {};
  const rawList = Array.isArray(body.challenges) ? body.challenges : [body.challenge || body];
  const sanitizedList = rawList.map(sanitizeChallenge).filter(Boolean);

  if (sanitizedList.length === 0) {
    return res.status(400).json({ error: 'Invalid challenge payload: missing or malformed required fields' });
  }

  try {
    const client = await getRedisClient(req, redisUrl);

    for (const challenge of sanitizedList) {
      await client.hset('challenges:schedule', challenge.id, JSON.stringify(challenge));
    }

    // Also update the active_challenge pointer with the primary challenge
    await client.set('active_challenge', JSON.stringify(sanitizedList));

    return res.status(200).json({
      success: true,
      publishedCount: sanitizedList.length,
      challenges: sanitizedList,
    });
  } catch (err) {
    console.error('[Publish Challenge Admin API Error]', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
