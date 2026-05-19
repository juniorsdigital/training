'use strict';

const assert = require('assert');
const {
  estimateProjectedTss,
  applyProjectedTssGoals,
  tssFromDurationAndIf,
  DEFAULT_FTP
} = require('../lib/projectedTss.js');

function run() {
  const z2_90 = estimateProjectedTss({ sessionType: 'z2', durationMin: 90, ftp: 239 });
  assert.strictEqual(z2_90.source, 'zone');
  assert.strictEqual(z2_90.ifUsed, 0.65);
  assert.strictEqual(z2_90.tss, tssFromDurationAndIf(90, 0.65), 'z2 90min TSS');

  const manual = estimateProjectedTss({
    sessionType: 'z2',
    durationMin: 90,
    goals: [{ goal_type: 'goal_tss', target_value: 80, notes: 'source:manual' }]
  });
  assert.strictEqual(manual.source, 'manual');
  assert.strictEqual(manual.tss, 80);

  const watts = estimateProjectedTss({
    sessionType: 'z2',
    durationMin: 90,
    ftp: 239,
    watts: 180
  });
  assert.strictEqual(watts.source, 'watts');
  assert.ok(Math.abs(watts.ifUsed - 180 / 239) < 0.01);

  const rest = estimateProjectedTss({ sessionType: 'rest' });
  assert.strictEqual(rest.tss, 0);

  const missing = estimateProjectedTss({ sessionType: 'vo2' });
  assert.strictEqual(missing.tss, null);

  const applied = applyProjectedTssGoals(
    { session_type: 'z2', target_watts_label: null },
    [
      { goal_type: 'goal_duration_min', target_value: 90, unit: 'min' },
      { goal_type: 'goal_wattage', target_value: 180, unit: 'W' }
    ],
    { ftp: DEFAULT_FTP }
  );
  const tssGoal = applied.find((g) => g.goal_type === 'goal_tss');
  assert.ok(tssGoal, 'adds auto goal_tss');
  assert.strictEqual(tssGoal.notes, 'source:auto');

  assert.throws(
    () =>
      applyProjectedTssGoals({ session_type: 'thr' }, [], { ftp: DEFAULT_FTP, enforceTss: true }),
    /goal_duration_min is required/
  );

  console.log('projected-tss tests: PASS');
}

run();
