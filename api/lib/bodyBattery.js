'use strict';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 1) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function logistic(value, midpoint, steepness) {
  return 1 / (1 + Math.exp(-steepness * (value - midpoint)));
}

function pctFromTarget(actual, target) {
  if (actual == null || target == null || target <= 0) return null;
  return clamp(actual / target, 0, 2);
}

function pickNumber(obj, candidates) {
  if (!obj || typeof obj !== 'object') return null;
  for (const key of candidates) {
    const n = Number(obj[key]);
    if (!Number.isNaN(n) && Number.isFinite(n)) return n;
  }
  return null;
}

function normalizeSignals(inputs) {
  const wellness = inputs?.wellness || {};
  const vitals = inputs?.vitals || {};
  const activity = inputs?.primaryActivity || {};
  const history = Array.isArray(inputs?.activityHistory) ? inputs.activityHistory : [];
  const nutrition = inputs?.nutrition || {};

  const sleepHours = pickNumber(wellness, ['sleepSecs', 'sleepSeconds']) != null
    ? pickNumber(wellness, ['sleepSecs', 'sleepSeconds']) / 3600
    : pickNumber(wellness, ['sleepHours', 'sleep_hours']);
  const hrv = pickNumber(wellness, ['hrv', 'hrvMs', 'hrv_rmssd']);
  const restingHr = pickNumber(wellness, ['restingHr', 'rest_hr', 'resting_hr']);
  const readiness = pickNumber(wellness, ['readiness', 'readinessScore', 'recoveryScore']);
  const stress = pickNumber(wellness, ['stress', 'stressScore', 'fatigue']);
  const atl = pickNumber(wellness, ['atl', 'acuteLoad', 'fatigueLoad']);
  const ctl = pickNumber(wellness, ['ctl', 'chronicLoad', 'fitnessLoad']);
  const tsb = pickNumber(wellness, ['tsb', 'form', 'freshness']);

  const activityLoadToday = pickNumber(activity, ['icuTrainingLoad']) || 0;
  const caloriesBurned = pickNumber(activity, ['calories']) || 0;
  const nutritionGoal = pickNumber(nutrition.goal, ['goal_calories']) || null;
  const nutritionLogged = Number(nutrition.totalCalories || 0);

  const recentLoads = history
    .map((item) => Number(item.icuTrainingLoad || 0))
    .filter((n) => Number.isFinite(n) && n >= 0);
  const last7LoadAvg = recentLoads.length
    ? recentLoads.slice(0, 7).reduce((sum, n) => sum + n, 0) / Math.min(7, recentLoads.length)
    : 0;
  const last14LoadAvg = recentLoads.length
    ? recentLoads.slice(0, 14).reduce((sum, n) => sum + n, 0) / Math.min(14, recentLoads.length)
    : 0;

  const strainIndex = clamp((activityLoadToday + last7LoadAvg * 0.6) / 160, 0, 2);
  const nutritionPct = nutritionGoal ? pctFromTarget(nutritionLogged, nutritionGoal) : null;

  return {
    sleepHours,
    hrv,
    restingHr,
    readiness,
    stress,
    atl,
    ctl,
    tsb,
    ftp: pickNumber(vitals, ['ftp']),
    vo2max: pickNumber(vitals, ['vo2max']),
    activityLoadToday,
    caloriesBurned,
    nutritionPct,
    recentLoads,
    last7LoadAvg,
    last14LoadAvg,
    strainIndex
  };
}

function scoreDailyEnergy(signals) {
  const components = [];
  const add = (key, label, points, normalized, raw) => {
    components.push({
      key,
      label,
      points: round(points, 1),
      normalized: normalized == null ? null : round(normalized, 3),
      raw: raw == null ? null : round(raw, 2)
    });
  };

  let score = 50;
  let available = 0;

  if (signals.sleepHours != null) {
    const n = clamp(signals.sleepHours / 8, 0, 1.2);
    const points = (n - 0.65) * 28;
    add('sleep', 'Sleep duration', points, n, signals.sleepHours);
    score += points;
    available += 1;
  }

  if (signals.readiness != null) {
    const n = clamp(signals.readiness / 100, 0, 1);
    const points = (n - 0.5) * 24;
    add('readiness', 'Readiness score', points, n, signals.readiness);
    score += points;
    available += 1;
  }

  if (signals.hrv != null) {
    const n = logistic(signals.hrv, 45, 0.08);
    const points = (n - 0.5) * 16;
    add('hrv', 'HRV', points, n, signals.hrv);
    score += points;
    available += 1;
  }

  if (signals.restingHr != null) {
    const n = 1 - logistic(signals.restingHr, 58, 0.12);
    const points = (n - 0.5) * 12;
    add('restingHr', 'Resting HR', points, n, signals.restingHr);
    score += points;
    available += 1;
  }

  if (signals.strainIndex != null) {
    const n = clamp(1 - signals.strainIndex / 1.3, 0, 1);
    const points = (n - 0.5) * 26;
    add('strain', 'Recent training strain', points, n, signals.strainIndex);
    score += points;
    available += 1;
  }

  if (signals.nutritionPct != null) {
    const n = clamp(1 - Math.abs(signals.nutritionPct - 1), 0, 1);
    const points = (n - 0.5) * 10;
    add('nutrition', 'Nutrition target match', points, n, signals.nutritionPct);
    score += points;
    available += 1;
  }

  if (signals.tsb != null) {
    const n = logistic(signals.tsb, 0, 0.1);
    const points = (n - 0.5) * 14;
    add('freshness', 'Freshness / Form', points, n, signals.tsb);
    score += points;
    available += 1;
  }

  score = clamp(score, 0, 100);

  const missing = [];
  if (signals.sleepHours == null) missing.push('sleep');
  if (signals.readiness == null) missing.push('readiness');
  if (signals.hrv == null) missing.push('hrv');
  if (signals.restingHr == null) missing.push('restingHr');
  if (signals.nutritionPct == null) missing.push('nutrition');

  const confidence = clamp(available / 7, 0.25, 1);
  const sorted = components.slice().sort((a, b) => Math.abs(b.points) - Math.abs(a.points));
  const positives = sorted.filter((c) => c.points > 0).slice(0, 3);
  const negatives = sorted.filter((c) => c.points < 0).slice(0, 3);

  let status = 'Moderate';
  if (score >= 75) status = 'High';
  else if (score < 45) status = 'Low';

  return {
    score: round(score, 0),
    status,
    confidence: round(confidence * 100, 0),
    components,
    topPositive: positives,
    topNegative: negatives,
    missing
  };
}

function scoreFitnessTrend(signals, previousDailyScore) {
  const acute = signals.last7LoadAvg || 0;
  const chronic = signals.last14LoadAvg || 0;
  const loadBalance = chronic > 0 ? acute / chronic : 1;
  const growthSignal = clamp(1 - Math.abs(loadBalance - 1), 0, 1);

  const recoveryPenalty = clamp((1 - (previousDailyScore || 50) / 100) * 0.7, 0, 0.7);
  const growth = growthSignal * 18;
  const decay = recoveryPenalty * 12;
  const delta = growth - decay;

  const baseline = clamp(50 + (signals.ctl || 0) * 0.25 - (signals.atl || 0) * 0.18, 20, 85);
  const trendScore = clamp(baseline + delta, 0, 100);

  let direction = 'flat';
  if (delta > 2) direction = 'up';
  else if (delta < -2) direction = 'down';

  return {
    score: round(trendScore, 0),
    delta: round(delta, 1),
    direction,
    acuteLoadAvg: round(acute, 1),
    chronicLoadAvg: round(chronic, 1),
    loadBalance: round(loadBalance, 2)
  };
}

function buildBodyBattery(inputs) {
  const signals = normalizeSignals(inputs);
  const daily = scoreDailyEnergy(signals);
  const fitnessTrend = scoreFitnessTrend(signals, daily.score);
  return {
    generatedAt: new Date().toISOString(),
    dailyEnergy: daily,
    fitnessTrend,
    signals: {
      sleepHours: signals.sleepHours == null ? null : round(signals.sleepHours, 2),
      hrv: signals.hrv,
      restingHr: signals.restingHr,
      readiness: signals.readiness,
      stress: signals.stress,
      atl: signals.atl,
      ctl: signals.ctl,
      tsb: signals.tsb,
      todayLoad: round(signals.activityLoadToday || 0, 1),
      last7LoadAvg: round(signals.last7LoadAvg || 0, 1),
      last14LoadAvg: round(signals.last14LoadAvg || 0, 1),
      nutritionPct: signals.nutritionPct == null ? null : round(signals.nutritionPct * 100, 0)
    }
  };
}

module.exports = {
  buildBodyBattery,
  normalizeSignals,
  scoreDailyEnergy,
  scoreFitnessTrend
};
