const { assertAllowedEmail, verifySupabaseUser } = require('../lib/supabaseAuth.js');
const { fetchCompletedActivities } = require('../lib/workoutProviders.js');

async function persistActivitiesToSupabase(activities, source) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase database configuration.');
  }

  const rows = activities.map((activity) => ({
    activity_id: String(activity.id),
    started_at: activity.start_date_local || activity.start_date || null,
    name: activity.name || null,
    type: activity.type || null,
    avg_power: activity.average_power ?? null,
    normalized_power: activity.normalized_power ?? activity.weighted_avg_power ?? null,
    max_power: activity.max_power ?? null,
    source: source || null,
    payload: activity
  }));

  const response = await fetch(
    `${supabaseUrl}/rest/v1/intervals_activity_snapshots?on_conflict=activity_id`,
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase upsert failed: ${text || response.status}`);
  }

  return rows.length;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const accessToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!accessToken) {
      return res.status(401).json({ error: 'Missing auth token.' });
    }

    const user = await verifySupabaseUser(accessToken);
    try {
      assertAllowedEmail(user);
    } catch (err) {
      return res.status(err.statusCode || 403).json({ error: err.message });
    }

    const { source, activities, providerErrors } = await fetchCompletedActivities();
    const savedCount = await persistActivitiesToSupabase(Array.isArray(activities) ? activities : [], source);

    return res.status(200).json({ ok: true, savedCount, source, providerErrors });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
}
