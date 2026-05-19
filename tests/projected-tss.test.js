'use strict';

const assert = require('assert');
const {
  estimateProjectedTss,
  applyProjectedTssGoals,
  tssFromDurationAndIf,
  parseWattsRange,
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

  const rangeLabel = estimateProjectedTss({
    sessionType: 'z2',
    durationMin: 90,
    ftp: 239,
    targetWattsLabel: '134–179W'
  });
  assert.strictEqual(rangeLabel.source, 'watts');
  const midpoint = (134 + 179) / 2;
  assert.ok(Math.abs(rangeLabel.wattsUsed - midpoint) < 0.01, 'uses range midpoint');
  assert.ok(Math.abs(rangeLabel.ifUsed - midpoint / 239) < 0.01);
  assert.notStrictEqual(rangeLabel.tss, tssFromDurationAndIf(90, 134 / 239), 'not first digit only');

  const rangeGoals = estimateProjectedTss({
    sessionType: 'z2',
    durationMin: 90,
    ftp: 239,
    goals: [
      { goal_type: 'goal_wattage_min', target_value: 134, unit: 'W' },
      { goal_type: 'goal_wattage_max', target_value: 179, unit: 'W' }
    ]
  });
  assert.strictEqual(rangeGoals.source, 'watts');
  assert.strictEqual(rangeGoals.wattsMin, 134);
  assert.strictEqual(rangeGoals.wattsMax, 179);

  const parsed = parseWattsRange('SS: 201–225W');
  assert.strictEqual(parsed.min, 201);
  assert.strictEqual(parsed.max, 225);
  assert.strictEqual(parsed.point, 213);

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

  const appliedRange = applyProjectedTssGoals(
    { session_type: 'z2', target_watts_label: '134–179W' },
    [
      { goal_type: 'goal_duration_min', target_value: 90, unit: 'min' },
      { goal_type: 'goal_wattage_min', target_value: 134, unit: 'W' },
      { goal_type: 'goal_wattage_max', target_value: 179, unit: 'W' }
    ],
    { ftp: DEFAULT_FTP }
  );
  const rangeTss = appliedRange.find((g) => g.goal_type === 'goal_tss');
  assert.ok(rangeTss);
  assert.strictEqual(rangeTss.target_value, rangeLabel.tss);

  assert.throws(
    () =>
      applyProjectedTssGoals({ session_type: 'thr' }, [], { ftp: DEFAULT_FTP, enforceTss: true }),
    /goal_duration_min is required/
  );

  console.log('projected-tss tests: PASS');
}

run();
