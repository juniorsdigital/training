'use strict';

const assert = require('assert');
const { serializePlanToCsv, parsePlanCsv } = require('../lib/trainingPlanCsv.js');

function run() {
  const plan = {
    name: 'CSV Plan',
    start_date: '2026-05-04',
    status: 'active',
    total_weeks: 1,
    days: [
      {
        week_index: 0,
        day_index: 0,
        day_date: '2026-05-04',
        session_type: 'z2',
        label: 'Endurance Ride',
        details: 'Steady aerobic work',
        target_watts_label: '180W',
        am_session: '90min Z2',
        pm_session: null,
        phase_label: 'Base',
        phase_code: '1',
        goals: [{ goal_type: 'goal_wattage', target_value: 180, unit: 'W', notes: null, sort_order: 0 }]
      }
    ]
  };

  const csv = serializePlanToCsv(plan);
  assert.ok(csv.includes('plan_name,start_date,status,total_weeks'), 'contains CSV headers');
  const parsed = parsePlanCsv(csv);
  assert.strictEqual(parsed.name, plan.name, 'round-trips plan name');
  assert.strictEqual(parsed.start_date, plan.start_date, 'round-trips start date');
  assert.strictEqual(parsed.days.length, 1, 'round-trips day count');
  assert.strictEqual(parsed.days[0].label, 'Endurance Ride', 'round-trips day label');
  assert.strictEqual(parsed.days[0].goals[0].goal_type, 'goal_wattage', 'round-trips goals_json');

  console.log('training-plan-csv tests: PASS');
}

run();
