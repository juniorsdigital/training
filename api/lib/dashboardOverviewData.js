'use strict';

const { intervalsAuthorizationValue } = require('./intervalsBasicAuth.js');

const INTERVALS_BASE = 'https://intervals.icu/api/v1';

function numOrNull(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  return null;
}

function eventLocalDay(ev) {
  const s = ev.start_date_local || ev.start || ev.date || ev.day || '';
  return String(s).slice(0, 10);
}

function activityLocalDay(a) {
  const s = a.start_date_local || a.start_date || a.date || '';
  return String(s).slice(0, 10);
}

/** Intervals often exposes cycling FTP as sportInfo[].eftp (not top-level icu_ftp). */
function ftpFromWellnessSportInfo(wellness) {
  const infos = wellness?.sportInfo;
  if (!Array.isArray(infos)) return null;
  const cyclingTypes = new Set([
    'Ride',
    'VirtualRide',
    'EBikeRide',
    'MountainBikeRide',
    'GravelRide',
    'Cyclocross',
    'Race',
    'Handcycle',
    'Velomobile',
    'BMX'
  ]);
  for (const s of infos) {
    if (!s || typeof s !== 'object') continue;
    if (!cyclingTypes.has((s.type || '').toString())) continue;
    const v = numOrNull(s.eftp, s.icu_ftp, s.ftp, s.icuFtp);
    if (v != null) return v;
  }
  for (const s of infos) {
    if (!s || typeof s !== 'object') continue;
    const v = numOrNull(s.eftp, s.icu_ftp, s.ftp, s.icuFtp);
    if (v != null) return v;
  }
  return null;
}

function pickVitals(athlete, wellness) {
  const ftp = numOrNull(
    wellness?.icu_ftp,
    wellness?.ftp,
    ftpFromWellnessSportInfo(wellness),
    athlete?.icu_ftp,
    athlete?.icuFtp,
    athlete?.ftp,
    athlete?.threshold_power,
    athlete?.thresholdPower
  );
  const vo2max = numOrNull(
    wellness?.vo2max,
    wellness?.vo2_max,
    wellness?.vo2Max,
    athlete?.vo2max,
    athlete?.vo2_max,
    athlete?.vo2Max
  );
  const weightKg = numOrNull(
    wellness?.weight,
    athlete?.icu_weight,
    athlete?.weight,
    athlete?.weight_kg,
    athlete?.weightKg
  );
  return { ftp, vo2max, weightKg };
}

function summarizeActivity(a) {
  return {
    id: a.id,
    name: a.name || 'Activity',
    type: a.type || null,
    startLocal: a.start_date_local || a.start_date || null,
    movingTimeSec: a.moving_time ?? a.time ?? null,
    distanceM: a.distance ?? null,
    avgPower: a.average_power ?? null,
    normalizedPower: a.normalized_power ?? a.weighted_avg_power ?? null,
    icuTrainingLoad: a.icu_training_load ?? a.training_load ?? null,
    calories: a.calories ?? null,
    maxPower: a.max_power ?? null
  };
}

const CYCLING_TYPES = new Set([
  'Ride',
  'VirtualRide',
  'EBikeRide',
  'MountainBikeRide',
  'GravelRide',
  'Cyclocross',
  'BMX',
  'Handcycle',
  'Velomobile',
  'Race'
]);

function isCyclingActivity(a) {
  const t = (a.type || '').toString();
  return CYCLING_TYPES.has(t);
}

function pickPrimaryActivity(activities, localDate) {
  const todayActs = (activities || []).filter((a) => activityLocalDay(a) === localDate);
  if (!todayActs.length) return null;
  const cycling = todayActs.filter(isCyclingActivity);
  const pool = cycling.length ? cycling : todayActs;
  pool.sort((a, b) => (b.moving_time || 0) - (a.moving_time || 0));
  return pool[0];
}

async function intervalsFetchJson(apiKey, path) {
  const response = await fetch(`${INTERVALS_BASE}${path}`, {
    headers: { Authorization: intervalsAuthorizationValue(apiKey) }
  });
  const text = await response.text();
  if (!response.ok) {
    return { ok: false, status: response.status, body: text };
  }
  try {
    return { ok: true, data: text ? JSON.parse(text) : null };
  } catch {
    return { ok: false, status: response.status, body: 'Invalid JSON from Intervals.icu' };
  }
}

function asArray(data) {
  if (!data) return [];
  return Array.isArray(data) ? data : [];
}

/**
 * @param {string} localDate YYYY-MM-DD
 * @returns {Promise<object>}
 */
async function buildDashboardOverviewPayload(localDate) {
  const intervalsApiKey = process.env.INTERVALS_API_KEY;
  if (!intervalsApiKey) {
    throw new Error('Missing Intervals API key.');
  }

  const athleteId = process.env.INTERVALS_ATHLETE_ID || '0';
  const fetchErrors = {};

  const athleteRes = await intervalsFetchJson(
    intervalsApiKey,
    `/athlete/${athleteId}`
  );
  let athlete = null;
  if (athleteRes.ok) {
    athlete = athleteRes.data;
  } else {
    fetchErrors.athlete = athleteRes.body || String(athleteRes.status);
  }

  const wellnessRes = await intervalsFetchJson(
    intervalsApiKey,
    `/athlete/${athleteId}/wellness/${localDate}`
  );
  let wellness = null;
  if (wellnessRes.ok) {
    wellness = wellnessRes.data;
  } else if (wellnessRes.status !== 404) {
    fetchErrors.wellness = wellnessRes.body || String(wellnessRes.status);
  }

  const eventsRes = await intervalsFetchJson(
    intervalsApiKey,
    `/athlete/${athleteId}/events?oldest=${localDate}&newest=${localDate}`
  );
  let events = [];
  if (eventsRes.ok) {
    events = asArray(eventsRes.data).filter((ev) => eventLocalDay(ev) === localDate);
  } else {
    fetchErrors.events = eventsRes.body || String(eventsRes.status);
  }

  let activitiesRes = await intervalsFetchJson(
    intervalsApiKey,
    `/athlete/${athleteId}/activities?oldest=${localDate}&newest=${localDate}`
  );
  let activities = [];
  if (activitiesRes.ok) {
    activities = asArray(activitiesRes.data);
  } else {
    fetchErrors.activities = activitiesRes.body || String(activitiesRes.status);
    const fallback = await intervalsFetchJson(
      intervalsApiKey,
      `/athlete/${athleteId}/activities?limit=80`
    );
    if (fallback.ok) {
      activities = asArray(fallback.data).filter((a) => activityLocalDay(a) === localDate);
    }
  }

  // #region agent log
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9571d2'},body:JSON.stringify({sessionId:'9571d2',location:'dashboardOverviewData.js:212',message:'vo2max fields - wellness',hypothesisId:'A-B-C-D',data:{wellnessStatus:wellnessRes.status,wellnessOk:wellnessRes.ok,wo_vo2max:wellness?.vo2max,wo_vo2_max:wellness?.vo2_max,wo_vo2Max:wellness?.vo2Max,wo_icu_vo2max:wellness?.icu_vo2max,w_full:wellness?JSON.stringify(Object.fromEntries(Object.entries(wellness).filter(([k])=>k.toLowerCase().includes('vo2')))):null},timestamp:Date.now()})}).catch(()=>{});
  fetch('http://127.0.0.1:7393/ingest/08dac9f5-b509-4991-86ef-01bcfd09de75',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'9571d2'},body:JSON.stringify({sessionId:'9571d2',location:'dashboardOverviewData.js:212',message:'vo2max fields - athlete',hypothesisId:'A-B-C-D',data:{athleteOk:athleteRes.ok,ao_vo2max:athlete?.vo2max,ao_vo2_max:athlete?.vo2_max,ao_vo2Max:athlete?.vo2Max,ao_icu_vo2max:athlete?.icu_vo2max,a_full:athlete?JSON.stringify(Object.fromEntries(Object.entries(athlete).filter(([k])=>k.toLowerCase().includes('vo2')))):null},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  const vitals = pickVitals(athlete, wellness);
  const primaryActivity = pickPrimaryActivity(activities, localDate);
  const activitiesToday = activities
    .filter((a) => activityLocalDay(a) === localDate)
    .map(summarizeActivity);

  return {
    localDate,
    vitals,
    eventsToday: events.map((ev) => ({
      id: ev.id,
      name: ev.name || ev.title || 'Event',
      category: ev.category || ev.type || null,
      startLocal: ev.start_date_local || ev.start || null,
      description: ev.description || null,
      workout_doc: ev.workout_doc || null
    })),
    activitiesToday,
    primaryActivity: primaryActivity ? summarizeActivity(primaryActivity) : null,
    fetchErrors: Object.keys(fetchErrors).length ? fetchErrors : undefined
  };
}

module.exports = { buildDashboardOverviewPayload };
