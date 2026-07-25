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

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    return res.status(500).json({ error: 'Database connection configuration missing' });
  }

  try {
    // Send command to Vercel KV REST API
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['ZADD', 'leaderboard', parsedScore, cleanUsername]),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: 'Database error', details: data });
    }

    return res.status(200).json({ success: true, result: data.result });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error', details: err.message });
  }
}
