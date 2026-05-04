const { assertAllowedEmail, verifySupabaseUser } = require('./lib/supabaseAuth.js');
const { intervalsAuthorizationValue } = require('./lib/intervalsBasicAuth.js');

const INTERVALS_BASE_URL = 'https://intervals.icu/api/v1';

function formatYyyyMmDdUtc(d) {
  return d.toISOString().slice(0, 10);
}

async function fetchIntervalsActivities(intervalsApiKey) {
  const athleteId = process.env.INTERVALS_ATHLETE_ID || '0';
  const newest = formatYyyyMmDdUtc(new Date());
  const oldestDate = new Date();
  oldestDate.setUTCDate(oldestDate.getUTCDate() - 365);
  const oldest = formatYyyyMmDdUtc(oldestDate);
  const activitiesUrl = `${INTERVALS_BASE_URL}/athlete/${athleteId}/activities?oldest=${oldest}&newest=${newest}&limit=500`;
  // #region agent log
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '79be01' },
    body: JSON.stringify({
      sessionId: '79be01',
      runId: 'pre-fix',
      hypothesisId: 'H1',
      location: 'api/intervals.js:fetchIntervalsActivities',
      message: 'activities request URL and query params',
      data: {
        activitiesUrl,
        hasOldestParam: activitiesUrl.includes('oldest='),
        hasNewestParam: activitiesUrl.includes('newest=')
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
  const response = await fetch(activitiesUrl, {
    headers: {
      Authorization: intervalsAuthorizationValue(intervalsApiKey)
    }
  });

  if (!response.ok) {
    const text = await response.text();
    // #region agent log
    fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '79be01' },
      body: JSON.stringify({
        sessionId: '79be01',
        runId: 'pre-fix',
        hypothesisId: 'H1',
        location: 'api/intervals.js:fetchIntervalsActivities:error',
        message: 'intervals activities non-OK response',
        data: {
          status: response.status,
          bodyPreview: (text || '').slice(0, 200)
        },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion
    throw new Error(`Intervals.icu API error: ${text || response.status}`);
  }

  const data = await response.json();
  // #region agent log
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '79be01' },
    body: JSON.stringify({
      sessionId: '79be01',
      runId: 'post-fix',
      hypothesisId: 'H1',
      location: 'api/intervals.js:fetchIntervalsActivities:success',
      message: 'activities fetch OK after oldest/newest',
      data: {
        athleteId,
        oldest,
        newest,
        activityCount: Array.isArray(data) ? data.length : null
      },
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
  return data;
}

async function persistActivitiesToSupabase(activities) {
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

    const intervalsApiKey = process.env.INTERVALS_API_KEY;
    if (!intervalsApiKey) {
      return res.status(500).json({ error: 'Missing Intervals API key.' });
    }

    // #region agent log
    fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '79be01' },
      body: JSON.stringify({
        sessionId: '79be01',
        runId: 'pre-fix',
        hypothesisId: 'H5',
        location: 'api/intervals.js:handler',
        message: 'POST /api/intervals sync invoked',
        data: { hasIntervalsKey: Boolean(intervalsApiKey) },
        timestamp: Date.now()
      })
    }).catch(() => {});
    // #endregion

    const activities = await fetchIntervalsActivities(intervalsApiKey);
    const savedCount = await persistActivitiesToSupabase(Array.isArray(activities) ? activities : []);

    return res.status(200).json({ ok: true, savedCount });
  } catch (error) {
    return res.status(500).json({ error: error.message || 'Unexpected server error.' });
  }
}
