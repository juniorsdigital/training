'use strict';

const assert = require('assert');
const { cloneDaySnapshot, transferSession, clearToRest } = require('../lib/trainingPlanAiOps.js');

function buildMoveSnapshots(fromDay, toDay, toWeekIndex, toDayIndex, toDayDate) {
  const fromSnap = cloneDaySnapshot(fromDay);
  const toSnap = cloneDaySnapshot(toDay);
  transferSession(fromSnap, toSnap);
  clearToRest(fromSnap);
  const sessionSlot = Number.isInteger(Number(fromDay.session_slot)) ? Number(fromDay.session_slot) : 0;
  toSnap.week_index = toWeekIndex;
  toSnap.day_index = toDayIndex;
  toSnap.day_date = toDayDate;
  toSnap.session_slot = sessionSlot;
  return { fromSnap, toSnap };
}

function run() {
  const fromDay = {
    id: 'from-1',
    week_index: 0,
    day_index: 0,
    day_date: '2026-05-04',
    session_type: 'z2',
    label: 'Endurance',
    session_slot: 1,
    time_slot: 'pm',
    phase_label: 'Base',
    phase_code: '1',
    week_target_tss: 400,
    goals: [{ goal_type: 'goal_duration_min', target_value: 90 }]
  };
  const snap = cloneDaySnapshot(fromDay);
  assert.strictEqual(snap.session_slot, 1, 'clone preserves session_slot');
  assert.strictEqual(snap.time_slot, 'pm');
  assert.strictEqual(snap.phase_code, '1');
  assert.strictEqual(snap.week_target_tss, 400);

  const toDay = {
    id: 'to-1',
    week_index: 0,
    day_index: 2,
    day_date: '2026-05-04',
    session_type: 'rest',
    label: 'REST',
    session_slot: 1,
    goals: []
  };

  const { fromSnap, toSnap } = buildMoveSnapshots(fromDay, toDay, 0, 2, '2026-05-06');
  assert.strictEqual(toSnap.session_type, 'z2');
  assert.strictEqual(toSnap.label, 'Endurance');
  assert.strictEqual(toSnap.session_slot, 1, 'move keeps source session_slot');
  assert.strictEqual(toSnap.day_date, '2026-05-06', 'move sets target day_date');
  assert.strictEqual(toSnap.day_index, 2);
  assert.strictEqual(fromSnap.session_type, 'rest');
  assert.strictEqual(fromSnap.session_slot, 1, 'source slot unchanged after clear');

  const dayA = { ...fromDay, id: 'a', session_slot: 0, label: 'A' };
  const dayB = { ...toDay, id: 'b', session_slot: 0, session_type: 'z3', label: 'B' };
  const snapA = cloneDaySnapshot(dayA);
  const snapB = cloneDaySnapshot(dayB);
  const hold = cloneDaySnapshot(dayA);
  transferSession(snapB, snapA);
  transferSession(hold, snapB);
  assert.strictEqual(snapA.session_slot, 0);
  assert.strictEqual(snapB.session_slot, 0);
  assert.strictEqual(snapA.label, 'B');
  assert.strictEqual(snapB.label, 'A');

  console.log('training-plan-move tests: PASS');
}

run();
