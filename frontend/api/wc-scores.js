module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  const token = process.env.FOOTBALL_API_TOKEN;
  if (!token) return res.status(500).json({ error: 'FOOTBALL_API_TOKEN not configured' });

  try {
    const r = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
      headers: { 'X-Auth-Token': token }
    });
    if (!r.ok) {
      const text = await r.text();
      return res.status(r.status).json({ error: `API error ${r.status}`, detail: text.slice(0, 300) });
    }
    const data = await r.json();
    return res.status(200).json({ ok: true, matches: data.matches || [] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
