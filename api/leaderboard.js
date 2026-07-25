// Fetch top scores from Vercel KV Redis database
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

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    // Fetch the top 100 players from the sorted set (high to low)
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['ZREVRANGE', 'leaderboard', 0, 99, 'WITHSCORES']),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Database error', details: data });
    }

    const rawList = data.result || [];
    const formattedLeaderboard = [];

    // Parse flat array [username1, score1, username2, score2, ...] into objects
    for (let i = 0; i < rawList.length; i += 2) {
      const username = rawList[i];
      const score = parseInt(rawList[i + 1], 10);
      formattedLeaderboard.push({
        username,
        score: isNaN(score) ? 0 : score,
        rank: (i / 2) + 1,
      });
    }

    return res.status(200).json({ success: true, leaderboard: formattedLeaderboard });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
