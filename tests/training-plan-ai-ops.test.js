'use strict';

const assert = require('assert');
const {
  normalizeOperations,
  buildPreview,
  applyOperationsToPlan,
  createProposalHash
} = require('../lib/trainingPlanAiOps.js');

function buildPlan() {
  return {
    id: 'plan-1',
    version: 3,
    days: [
      {
        id: 'd1',
        week_index: 0,
        day_index: 0,
        day_date: '2026-05-04',
        session_type: 'z2',
        label: 'Endurance',
        details: 'Steady aerobic',
        target_watts_label: '180W',
        am_session: '90min Z2',
        pm_session: null,
        goals: [{ goal_type: 'goal_wattage', target_value: 180, unit: 'W', notes: null, sort_order: 0 }]
      },
      {
        id: 'd2',
        week_index: 0,
        day_index: 1,
        day_date: '2026-05-05',
        session_type: 'thr',
        label: 'Threshold',
        details: '2x20 @ threshold',
        target_watts_label: '240W',
        am_session: '2x20',
        pm_session: null,
        goals: [{ goal_type: 'goal_wattage', target_value: 240, unit: 'W', notes: null, sort_order: 0 }]
      }
    ]
  };
}

function run() {
  const plan = buildPlan();
  const ops = normalizeOperations(plan, [
    {
      type: 'move_day_session',
      from: { day_id: 'd2' },
      to: { week_index: 0, day_index: 0 }
    },
    {
      type: 'update_day_notes',
      target: { day_id: 'd1' },
      notes: 'Shifted due to scheduling conflict.',
      mode: 'append'
    }
  ]);

  assert.strictEqual(ops.length, 2, 'normalizes operation list');

  const preview = buildPreview(plan, ops);
  assert.strictEqual(preview.operation_count, 2, 'preview includes operation count');
  assert.ok(preview.affected_days.length >= 2, 'preview includes affected days');

  const updated = applyOperationsToPlan(plan, ops);
  const movedDay = updated.days.find((day) => day.id === 'd1');
  const clearedDay = updated.days.find((day) => day.id === 'd2');
  assert.strictEqual(movedDay.session_type, 'thr', 'move transfers workout');
  assert.ok(String(movedDay.details).includes('Shifted due to scheduling conflict.'), 'notes append is applied');
  assert.strictEqual(clearedDay.session_type, 'rest', 'source day is reset to rest');
  assert.strictEqual(clearedDay.label, 'REST', 'source day label reset');

  const hashA = createProposalHash(plan, ops);
  const hashB = createProposalHash(plan, ops);
  assert.strictEqual(hashA, hashB, 'proposal hash is stable for same inputs');

  assert.throws(
    () =>
      normalizeOperations(plan, [
        {
          type: 'delete_week',
          week_index: 0
        }
      ]),
    /Unsupported operation/,
    'rejects unsupported operations'
  );

  console.log('training-plan-ai-ops tests: PASS');
}

run();
