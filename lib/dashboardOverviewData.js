'use strict';

const { intervalsAuthorizationValue } = require('./intervalsBasicAuth.js');
const { buildBodyBattery } = require('./bodyBattery.js');

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

function pickNumberFromObject(obj, keys) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of keys) {
    const n = Number(obj[key]);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return null;
}

function buildWellnessSignals(wellness) {
  if (!wellness || typeof wellness !== 'object') return {};
  const sleepSecs = pickNumberFromObject(wellness, [
    'sleepSecs',
    'sleepSec',
    'sleep_seconds',
    'sleepDuration',
    'sleep_duration'
  ]);
  const sleepHoursRaw = pickNumberFromObject(wellness, ['sleepHours', 'sleep_hours']);
  const sleepHours = sleepHoursRaw != null ? sleepHoursRaw : (sleepSecs != null ? sleepSecs / 3600 : null);

  return {
    sleepHours,
    sleepSecs: sleepSecs != null ? sleepSecs : (sleepHours != null ? sleepHours * 3600 : null),
    hrv: pickNumberFromObject(wellness, ['hrv', 'hrvMs', 'hrv_rmssd']),
    restingHr: pickNumberFromObject(wellness, ['restingHr', 'resting_hr', 'rest_hr', 'rhr']),
    readiness: pickNumberFromObject(wellness, ['readiness', 'readinessScore', 'recovery_score']),
    stress: pickNumberFromObject(wellness, ['stress', 'stressScore', 'fatigue']),
    sleepScore: pickNumberFromObject(wellness, ['sleepScore', 'sleep_score']),
    recoveryScore: pickNumberFromObject(wellness, ['recovery', 'recoveryScore']),
    atl: pickNumberFromObject(wellness, ['atl', 'acuteLoad', 'fatigueLoad']),
    ctl: pickNumberFromObject(wellness, ['ctl', 'chronicLoad', 'fitnessLoad']),
    tsb: pickNumberFromObject(wellness, ['tsb', 'form', 'freshness']),
    raw: wellness
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

function restUrl(path) {
  return `${process.env.SUPABASE_URL}/rest/v1${path}`;
}

async function fetchNutritionSummary(localDate) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    return { logs: [], goal: null, totalCalories: 0, totalCarbs: 0, totalProtein: 0, totalFat: 0 };
  }

  try {
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    };
    const [logsRes, goalsRes] = await Promise.all([
      fetch(restUrl(`/nutrition_logs?log_date=eq.${localDate}&select=calories,carbs,protein,fat`), { headers }),
      fetch(restUrl(`/nutrition_goals?log_date=eq.${localDate}&select=goal_calories,carbs_goal,protein_goal,fat_goal`), { headers })
    ]);

    if (!logsRes.ok || !goalsRes.ok) {
      return { logs: [], goal: null, totalCalories: 0, totalCarbs: 0, totalProtein: 0, totalFat: 0 };
    }

    const logs = asArray(await logsRes.json());
    const goals = asArray(await goalsRes.json());
    return {
      logs,
      goal: goals[0] || null,
      totalCalories: logs.reduce((sum, row) => sum + (Number(row.calories) || 0), 0),
      totalCarbs: logs.reduce((sum, row) => sum + (Number(row.carbs) || 0), 0),
      totalProtein: logs.reduce((sum, row) => sum + (Number(row.protein) || 0), 0),
      totalFat: logs.reduce((sum, row) => sum + (Number(row.fat) || 0), 0)
    };
  } catch {
    return { logs: [], goal: null, totalCalories: 0, totalCarbs: 0, totalProtein: 0, totalFat: 0 };
  }
}

/**
 * @param {string} localDate YYYY-MM-DD
 * @returns {Promise<object>}
 */
async function buildDashboardOverviewPayload(localDate, options = {}) {
  const historyDays = Number.isInteger(Number(options.historyDays)) && Number(options.historyDays) > 0
    ? Number(options.historyDays)
    : 14;
  const includeHistory = Boolean(options.includeHistory);
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

  if (!wellness?.vo2max) {
    const oldest = new Date(localDate);
    oldest.setDate(oldest.getDate() - 90);
    const oldestStr = oldest.toISOString().slice(0, 10);
    const rangeRes = await intervalsFetchJson(
      intervalsApiKey,
      `/athlete/${athleteId}/wellness?oldest=${oldestStr}&newest=${localDate}`
    );
    if (rangeRes.ok && Array.isArray(rangeRes.data)) {
      const recent = rangeRes.data
        .filter((w) => w && w.vo2max != null && Number(w.vo2max) > 0)
        .sort((a, b) => (b.id || b.date || '').localeCompare(a.id || a.date || ''));
      if (recent.length > 0) {
        wellness = wellness ? { ...wellness, vo2max: recent[0].vo2max } : recent[0];
      }
    }
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

  const vitals = pickVitals(athlete, wellness);
  const primaryActivity = pickPrimaryActivity(activities, localDate);
  const activitiesToday = activities
    .filter((a) => activityLocalDay(a) === localDate)
    .map(summarizeActivity);

  const oldestRecent = new Date(localDate);
  oldestRecent.setDate(oldestRecent.getDate() - historyDays);
  const oldestRecentStr = oldestRecent.toISOString().slice(0, 10);
  const [wellnessHistoryRes, activityHistoryRes, nutrition] = await Promise.all([
    intervalsFetchJson(intervalsApiKey, `/athlete/${athleteId}/wellness?oldest=${oldestRecentStr}&newest=${localDate}`),
    intervalsFetchJson(intervalsApiKey, `/athlete/${athleteId}/activities?oldest=${oldestRecentStr}&newest=${localDate}&limit=250`),
    fetchNutritionSummary(localDate)
  ]);

  const wellnessHistory = wellnessHistoryRes.ok ? asArray(wellnessHistoryRes.data) : [];
  const normalizedWellness = buildWellnessSignals(wellness);
  if (!wellnessHistoryRes.ok && wellnessHistoryRes.status !== 404) {
    fetchErrors.wellnessHistory = wellnessHistoryRes.body || String(wellnessHistoryRes.status);
  }

  const activityHistory = (activityHistoryRes.ok ? asArray(activityHistoryRes.data) : activities)
    .filter((a) => a && activityLocalDay(a) <= localDate)
    .sort((a, b) => (String(b.start_date_local || b.start_date || '').localeCompare(String(a.start_date_local || a.start_date || ''))))
    .map(summarizeActivity);
  if (!activityHistoryRes.ok && activityHistoryRes.status !== 404) {
    fetchErrors.activityHistory = activityHistoryRes.body || String(activityHistoryRes.status);
  }

  const bodyBattery = buildBodyBattery({
    localDate,
    vitals,
    wellness: normalizedWellness,
    wellnessHistory,
    primaryActivity: primaryActivity ? summarizeActivity(primaryActivity) : null,
    activityHistory,
    eventsToday: events,
    nutrition
  });

  const responsePayload = {
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
    wellnessSignals: normalizedWellness,
    nutritionSummary: {
      totalCalories: nutrition.totalCalories,
      totalCarbs: nutrition.totalCarbs,
      totalProtein: nutrition.totalProtein,
      totalFat: nutrition.totalFat,
      goal: nutrition.goal
    },
    bodyBattery,
    fetchErrors: Object.keys(fetchErrors).length ? fetchErrors : undefined
  };
  if (includeHistory) {
    responsePayload.activityHistory = activityHistory;
    responsePayload.wellnessHistory = wellnessHistory;
    responsePayload.historyWindowDays = historyDays;
  }
  return responsePayload;
}

module.exports = { buildDashboardOverviewPayload };
