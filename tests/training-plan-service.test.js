'use strict';

const assert = require('assert');
const {
  mapPlanToLegacyWeeks,
  buildExportDocument,
  EXPORT_FORMAT_VERSION
} = require('../api/lib/trainingPlanService.js');

function run() {
  const plan = {
    id: 'plan-1',
    name: 'Test Plan',
    start_date: '2026-05-04',
    days: [
      {
        week_index: 0,
        day_index: 0,
        session_type: 'z2',
        label: 'Endurance Ride',
        details: 'Steady aerobic volume',
        target_watts_label: '180W',
        am_session: '90min Z2',
        pm_session: null,
        goals: [
          { goal_type: 'goal_wattage', target_value: 180, unit: 'W', notes: 'Hold steady' },
          { goal_type: 'goal_heart_rate', target_value: 155, unit: 'bpm', notes: null }
        ]
      }
    ]
  };

  const weeks = mapPlanToLegacyWeeks(plan);
  assert.strictEqual(weeks.length, 1, 'maps one week');
  assert.strictEqual(weeks[0].days.length, 7, 'fills seven days');
  assert.strictEqual(weeks[0].days[0].lbl, 'Endurance Ride', 'maps label');
  assert.ok(weeks[0].days[0].det.includes('Goals:'), 'includes goals summary');

  const exported = buildExportDocument(plan);
  assert.strictEqual(exported.documentation.format_version, EXPORT_FORMAT_VERSION, 'includes format version');
  assert.ok(Array.isArray(exported.documentation.import_validation_rules), 'includes validation rules');
  assert.strictEqual(exported.plan.name, 'Test Plan', 'contains plan payload');

  console.log('training-plan-service tests: PASS');
}

run();
