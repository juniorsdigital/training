'use strict';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_RECENT_DAYS = 21;

function getApiKey() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini is not configured. Set GEMINI_API_KEY.');
  return key;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('AI response was empty.');
  const fencedMatch = raw.match(/```json\s*([\s\S]*?)```/i) || raw.match(/```\s*([\s\S]*?)```/);
  const candidate = fencedMatch ? fencedMatch[1].trim() : raw;
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  const slice = firstBrace >= 0 && lastBrace > firstBrace ? candidate.slice(firstBrace, lastBrace + 1) : candidate;
  return JSON.parse(slice);
}

function toCompactPlan(plan) {
  return {
    id: plan?.id || null,
    name: plan?.name || null,
    version: plan?.version || null,
    start_date: plan?.start_date || null,
    days: (Array.isArray(plan?.days) ? plan.days : []).map((day) => ({
      id: day.id,
      week_index: day.week_index,
      day_index: day.day_index,
      day_date: day.day_date,
      session_type: day.session_type,
      label: day.label,
      details: day.details,
      target_watts_label: day.target_watts_label,
      am_session: day.am_session,
      pm_session: day.pm_session
    }))
  };
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isoDateMinusDays(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function limitText(value, maxLen = 280) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function compactNutritionSummary(summary) {
  const src = summary && typeof summary === 'object' ? summary : {};
  return {
    totalCalories: Number.isFinite(Number(src.totalCalories)) ? Number(src.totalCalories) : null,
    totalCarbs: Number.isFinite(Number(src.totalCarbs)) ? Number(src.totalCarbs) : null,
    totalProtein: Number.isFinite(Number(src.totalProtein)) ? Number(src.totalProtein) : null,
    totalFat: Number.isFinite(Number(src.totalFat)) ? Number(src.totalFat) : null,
    goalCalories: Number.isFinite(Number(src?.goal?.goal_calories)) ? Number(src.goal.goal_calories) : null
  };
}

function summarizeActivityForContext(activity) {
  if (!activity || typeof activity !== 'object') return null;
  const when = String(activity.startLocal || '').slice(0, 10);
  return {
    source: 'activity_history',
    day_date: isIsoDate(when) ? when : null,
    label: limitText(activity.name || 'Activity', 120),
    session_type: limitText(activity.type || null, 40),
    moving_time_sec: Number.isFinite(Number(activity.movingTimeSec)) ? Number(activity.movingTimeSec) : null,
    training_load: Number.isFinite(Number(activity.icuTrainingLoad)) ? Number(activity.icuTrainingLoad) : null,
    avg_power: Number.isFinite(Number(activity.avgPower)) ? Number(activity.avgPower) : null,
    normalized_power: Number.isFinite(Number(activity.normalizedPower)) ? Number(activity.normalizedPower) : null,
    calories: Number.isFinite(Number(activity.calories)) ? Number(activity.calories) : null
  };
}

function summarizePlanDayForContext(day) {
  if (!day || typeof day !== 'object') return null;
  const dayDate = String(day.day_date || '').slice(0, 10);
  return {
    source: 'plan_fallback',
    day_date: isIsoDate(dayDate) ? dayDate : null,
    label: limitText(day.label || 'Workout', 120),
    session_type: limitText(day.session_type || 'rest', 24),
    details: limitText(day.details || null, 200),
    target_watts_label: limitText(day.target_watts_label || null, 80)
  };
}

function normalizeRecentActivities(activityHistory, bounds) {
  return (Array.isArray(activityHistory) ? activityHistory : [])
    .map((activity) => summarizeActivityForContext(activity))
    .filter((entry) => entry && entry.day_date && entry.day_date >= bounds.context_oldest && entry.day_date <= bounds.context_newest)
    .sort((a, b) => String(b.day_date).localeCompare(String(a.day_date)))
    .slice(0, 60);
}

function fallbackRecentPlanDays(plan, bounds) {
  return (Array.isArray(plan?.days) ? plan.days : [])
    .map((day) => summarizePlanDayForContext(day))
    .filter((entry) => entry && entry.day_date && entry.day_date >= bounds.context_oldest && entry.day_date <= bounds.context_newest)
    .sort((a, b) => String(b.day_date).localeCompare(String(a.day_date)))
    .slice(0, 21);
}

function buildAthleteContextForPrompt({ localDate, recentDays = DEFAULT_RECENT_DAYS, plan, overview }) {
  const newest = isIsoDate(localDate) ? localDate : new Date().toISOString().slice(0, 10);
  const boundedRecentDays = Number.isInteger(Number(recentDays)) && Number(recentDays) > 0 ? Number(recentDays) : DEFAULT_RECENT_DAYS;
  const context_oldest = isoDateMinusDays(newest, boundedRecentDays - 1);
  const bounds = {
    context_oldest,
    context_newest: newest,
    context_days: boundedRecentDays
  };
  const recentFromActivities = normalizeRecentActivities(overview?.activityHistory, bounds);
  const recentWorkoutContext = recentFromActivities.length ? recentFromActivities : fallbackRecentPlanDays(plan, bounds);
  const bodyBatteryDaily = overview?.bodyBattery?.dailyEnergy || {};
  const bodyBatteryTrend = overview?.bodyBattery?.fitnessTrend || {};
  return {
    ...bounds,
    athlete: {
      vitals: overview?.vitals || {},
      wellnessSignals: overview?.wellnessSignals || {},
      bodyBattery: {
        daily_status: bodyBatteryDaily.status || null,
        daily_score: Number.isFinite(Number(bodyBatteryDaily.score)) ? Number(bodyBatteryDaily.score) : null,
        fitness_status: bodyBatteryTrend.status || null,
        trend_7day: Number.isFinite(Number(bodyBatteryTrend.trend7Day)) ? Number(bodyBatteryTrend.trend7Day) : null
      },
      nutritionSummary: compactNutritionSummary(overview?.nutritionSummary)
    },
    recentWorkoutContext
  };
}

async function requestGeminiJson({ message, conversation, plan, athleteContext }) {
  const apiKey = getApiKey();
  const model = DEFAULT_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  const prompt = [
    'You are an assistant that proposes updates to an athlete training plan.',
    'Only produce valid JSON with this exact top-level shape:',
    '{ "assistant_message": string, "operations": array }',
    'Allowed operation types only:',
    '- move_day_session: { "type":"move_day_session", "from": {"day_id": string} or {"week_index": number, "day_index": number}, "to": {...}, "reason": string? }',
    '- swap_day_sessions: { "type":"swap_day_sessions", "day_a": selector, "day_b": selector, "reason": string? }',
    '- update_day_notes: { "type":"update_day_notes", "target": selector, "notes": string, "mode": "replace"|"append", "reason": string? }',
    'Disallowed: creating/deleting weeks/days, changing plan metadata, changing goal schema, nutrition or recovery edits.',
    'If request cannot be satisfied safely, return operations as empty array and explain in assistant_message.',
    '',
    `User request: ${message}`,
    `Conversation context (most recent first, optional): ${JSON.stringify(Array.isArray(conversation) ? conversation.slice(-8) : [])}`,
    `Athlete context (readiness + recent 2-3 weeks): ${JSON.stringify(athleteContext || {})}`,
    `Canonical plan snapshot: ${JSON.stringify(toCompactPlan(plan))}`
  ].join('\n');

  try {
    const response = await fetch(`${GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: 'application/json'
        }
      }),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = payload?.error?.message || 'Gemini request failed.';
      throw new Error(detail);
    }
    const text = payload?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n') || '';
    const parsed = extractJsonObject(text);
    return {
      assistant_message: String(parsed?.assistant_message || '').trim(),
      operations: Array.isArray(parsed?.operations) ? parsed.operations : []
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Gemini request timed out. Please try again.');
    }
    throw new Error(`Gemini unavailable: ${error.message || 'request failed'}`);
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  requestGeminiJson,
  buildAthleteContextForPrompt
};
