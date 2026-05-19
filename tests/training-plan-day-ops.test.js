'use strict';

const assert = require('assert');
const { transferSession, clearToRest, cloneDaySnapshot } = require('../lib/trainingPlanAiOps.js');

function run() {
  const source = {
    id: 'a',
    week_index: 1,
    day_index: 1,
    session_type: 'z2',
    label: 'Endurance',
    details: '90 min',
    target_watts_label: '180W',
    am_session: null,
    pm_session: null,
    goals: [
      { goal_type: 'goal_duration_min', target_value: 90 },
      { goal_type: 'goal_tss', target_value: 65, notes: 'source:auto' }
    ]
  };
  const target = {
    id: 'b',
    week_index: 1,
    day_index: 3,
    session_type: 'rest',
    label: 'REST',
    details: null,
    target_watts_label: null,
    am_session: null,
    pm_session: null,
    goals: []
  };

  const fromSnap = cloneDaySnapshot(source);
  const toSnap = cloneDaySnapshot(target);
  transferSession(fromSnap, toSnap);
  clearToRest(fromSnap);

  assert.strictEqual(toSnap.session_type, 'z2');
  assert.strictEqual(toSnap.label, 'Endurance');
  assert.strictEqual(toSnap.goals.length, 2);
  assert.strictEqual(fromSnap.session_type, 'rest');
  assert.strictEqual(fromSnap.goals.length, 0);

  const a = cloneDaySnapshot(source);
  const b = cloneDaySnapshot({
    ...target,
    session_type: 'vo2',
    label: 'VO2',
    goals: [{ goal_type: 'goal_duration_min', target_value: 60 }]
  });
  const hold = cloneDaySnapshot(a);
  transferSession(b, a);
  transferSession(hold, b);
  assert.strictEqual(a.label, 'VO2');
  assert.strictEqual(b.label, 'Endurance');

  console.log('training-plan-day-ops tests: PASS');
}

run();
