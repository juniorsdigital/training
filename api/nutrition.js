'use strict';

const { assertAllowedEmail, verifySupabaseUser } = require('./lib/supabaseAuth.js');

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Prefer': 'return=representation'
  };
}

function restUrl(path) {
  return `${process.env.SUPABASE_URL}/rest/v1${path}`;
}

async function authenticate(req, res) {
  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!accessToken) {
    res.status(401).json({ error: 'Missing auth token.' });
    return null;
  }
  let user;
  try {
    user = await verifySupabaseUser(accessToken);
  } catch {
    res.status(401).json({ error: 'Invalid session.' });
    return null;
  }
  try {
    assertAllowedEmail(user);
  } catch (err) {
    res.status(403).json({ error: err.message });
    return null;
  }
  return user;
}

module.exports = async function handler(req, res) {
  const user = await authenticate(req, res);
  if (!user) return;

  const { method } = req;

  // GET /api/nutrition?date=YYYY-MM-DD
  // Returns { logs: [...], goal: { goal_calories } | null }
  if (method === 'GET') {
    const date = (req.query.date || '').toString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Query param date=YYYY-MM-DD required.' });
    }

    const [logsResp, goalResp] = await Promise.all([
      fetch(restUrl(`/nutrition_logs?log_date=eq.${date}&order=created_at.asc`), {
        headers: supabaseHeaders()
      }),
      fetch(restUrl(`/nutrition_goals?log_date=eq.${date}`), {
        headers: supabaseHeaders()
      })
    ]);

    if (!logsResp.ok || !goalResp.ok) {
      return res.status(500).json({ error: 'Failed to fetch nutrition data.' });
    }

    const logs = await logsResp.json();
    const goals = await goalResp.json();

    return res.status(200).json({
      ok: true,
      logs: Array.isArray(logs) ? logs : [],
      goal: Array.isArray(goals) && goals.length > 0 ? goals[0] : null
    });
  }

  // POST /api/nutrition  body: { date, item, calories }  → add log entry
  // POST /api/nutrition  body: { date, goal_calories }   → upsert goal
  if (method === 'POST') {
    let body;
    try {
      body = req.body;
      if (typeof body === 'string') body = JSON.parse(body);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body.' });
    }

    // Upsert goal
    if (body.goal_calories !== undefined) {
      const date = (body.date || '').toString().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'date required (YYYY-MM-DD).' });
      }
      const goalCals = parseInt(body.goal_calories, 10);
      if (!Number.isFinite(goalCals) || goalCals <= 0) {
        return res.status(400).json({ error: 'goal_calories must be a positive integer.' });
      }

      const resp = await fetch(restUrl('/nutrition_goals'), {
        method: 'POST',
        headers: { ...supabaseHeaders(), 'Prefer': 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify({ log_date: date, goal_calories: goalCals, updated_at: new Date().toISOString() })
      });
      if (!resp.ok) {
        const txt = await resp.text();
        return res.status(500).json({ error: `DB error: ${txt}` });
      }
      const data = await resp.json();
      return res.status(200).json({ ok: true, goal: Array.isArray(data) ? data[0] : data });
    }

    // Add log entry
    const date = (body.date || '').toString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date required (YYYY-MM-DD).' });
    }
    const item = (body.item || '').trim();
    if (!item) return res.status(400).json({ error: 'item is required.' });
    const calories = parseInt(body.calories, 10);
    if (!Number.isFinite(calories) || calories < 0) {
      return res.status(400).json({ error: 'calories must be a non-negative integer.' });
    }

    const resp = await fetch(restUrl('/nutrition_logs'), {
      method: 'POST',
      headers: supabaseHeaders(),
      body: JSON.stringify({ log_date: date, item, calories })
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(500).json({ error: `DB error: ${txt}` });
    }
    const data = await resp.json();
    return res.status(201).json({ ok: true, log: Array.isArray(data) ? data[0] : data });
  }

  // DELETE /api/nutrition?id=UUID
  if (method === 'DELETE') {
    const id = (req.query.id || '').toString().trim();
    if (!id) return res.status(400).json({ error: 'Query param id required.' });

    const resp = await fetch(restUrl(`/nutrition_logs?id=eq.${encodeURIComponent(id)}`), {
      method: 'DELETE',
      headers: supabaseHeaders()
    });
    if (!resp.ok) {
      const txt = await resp.text();
      return res.status(500).json({ error: `DB error: ${txt}` });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ error: 'Method not allowed.' });
};
