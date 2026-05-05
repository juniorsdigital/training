'use strict';

const assert = require('assert');
const {
  buildBodyBattery,
  normalizeSignals
} = require('../api/lib/bodyBattery.js');

function run() {
  const goodRecovery = buildBodyBattery({
    vitals: { ftp: 280, vo2max: 59 },
    wellness: {
      sleepHours: 8.1,
      hrv: 62,
      restingHr: 48,
      readiness: 84,
      tsb: 8,
      ctl: 82,
      atl: 73
    },
    primaryActivity: { icuTrainingLoad: 40, calories: 600 },
    activityHistory: Array.from({ length: 14 }, (_, i) => ({
      icuTrainingLoad: i < 3 ? 35 : 55
    })),
    nutrition: {
      totalCalories: 3050,
      goal: { goal_calories: 3100 }
    }
  });

  assert.ok(goodRecovery.dailyEnergy.score >= 65, 'high-recovery scenario should score strong daily energy');
  assert.ok(goodRecovery.fitnessTrend.score >= 45, 'fitness trend should remain stable/positive');
  assert.ok(goodRecovery.dailyEnergy.confidence >= 70, 'confidence should be high with complete data');

  const heavyStrain = buildBodyBattery({
    wellness: {
      sleepHours: 5.1,
      hrv: 24,
      restingHr: 67,
      readiness: 35,
      tsb: -24,
      ctl: 61,
      atl: 101
    },
    primaryActivity: { icuTrainingLoad: 175, calories: 1900 },
    activityHistory: Array.from({ length: 14 }, () => ({ icuTrainingLoad: 160 })),
    nutrition: {
      totalCalories: 1400,
      goal: { goal_calories: 3000 }
    }
  });

  assert.ok(heavyStrain.dailyEnergy.score <= 45, 'heavy-strain scenario should lower daily energy');
  assert.ok(['Low', 'Moderate'].includes(heavyStrain.dailyEnergy.status), 'status should reflect fatigue pressure');

  const sparse = buildBodyBattery({
    wellness: {},
    primaryActivity: null,
    activityHistory: [],
    nutrition: { totalCalories: 0, goal: null }
  });
  assert.ok(sparse.dailyEnergy.confidence <= 50, 'sparse data should reduce confidence');
  assert.ok(Array.isArray(sparse.dailyEnergy.missing), 'missing keys list should be present');

  const normalized = normalizeSignals({
    wellness: { sleepSecs: 28800, readiness: 70 },
    activityHistory: [{ icuTrainingLoad: 50 }, { icuTrainingLoad: 70 }]
  });
  assert.strictEqual(normalized.sleepHours, 8, 'sleep seconds should normalize to hours');
  assert.ok(normalized.last7LoadAvg > 0, 'history load average should compute');

  console.log('body-battery tests: PASS');
}

run();
