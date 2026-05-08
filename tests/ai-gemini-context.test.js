'use strict';

const assert = require('assert');
const { buildAthleteContextForPrompt } = require('../lib/aiGemini.js');

function run() {
  const plan = {
    days: [
      { day_date: '2026-05-07', label: 'Threshold', session_type: 'thr', details: '2x20', target_watts_label: '250W' },
      { day_date: '2026-04-16', label: 'Too old', session_type: 'z2', details: 'Outside context window' }
    ]
  };

  const overview = {
    vitals: { ftp: 260, vo2max: 56.1, weightKg: 73.2 },
    wellnessSignals: { hrv: 68, restingHr: 49, readiness: 78, atl: 62, ctl: 58, tsb: -4 },
    nutritionSummary: { totalCalories: 2650, totalCarbs: 320, totalProtein: 155, totalFat: 70, goal: { goal_calories: 2900 } },
    bodyBattery: { dailyEnergy: { status: 'good', score: 78 }, fitnessTrend: { status: 'stable', trend7Day: 2.5 } },
    activityHistory: [
      { startLocal: '2026-05-08T07:30:00', name: 'VO2 Repeats', type: 'Ride', movingTimeSec: 4200, icuTrainingLoad: 98, avgPower: 251 },
      { startLocal: '2026-04-17T08:00:00', name: 'Endurance Ride', type: 'Ride', movingTimeSec: 7200, icuTrainingLoad: 85, avgPower: 188 },
      { startLocal: '2026-04-01T08:00:00', name: 'Old Ride', type: 'Ride', movingTimeSec: 6000, icuTrainingLoad: 70, avgPower: 175 }
    ]
  };

  const context = buildAthleteContextForPrompt({
    localDate: '2026-05-08',
    recentDays: 21,
    plan,
    overview
  });

  assert.strictEqual(context.context_newest, '2026-05-08', 'newest date is pinned');
  assert.strictEqual(context.context_oldest, '2026-04-18', 'oldest date is 21-day lower bound');
  assert.strictEqual(context.context_days, 21, 'context day count is recorded');
  assert.strictEqual(context.athlete.vitals.ftp, 260, 'athlete vitals are included');
  assert.ok(Array.isArray(context.recentWorkoutContext), 'recent workout context is an array');
  assert.strictEqual(context.recentWorkoutContext.length, 1, 'activities are bounded to 21 days');
  assert.strictEqual(context.recentWorkoutContext[0].source, 'activity_history', 'activity history is preferred');

  const fallback = buildAthleteContextForPrompt({
    localDate: '2026-05-08',
    recentDays: 21,
    plan,
    overview: {}
  });
  assert.strictEqual(fallback.recentWorkoutContext.length, 1, 'plan fallback is used when activities are missing');
  assert.strictEqual(fallback.recentWorkoutContext[0].source, 'plan_fallback', 'fallback source is marked');

  console.log('ai-gemini-context tests: PASS');
}

run();
