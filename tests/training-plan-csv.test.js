'use strict';

const assert = require('assert');
const {
  serializePlanToCsv,
  parsePlanCsv,
  mergeWattageGoalsFromColumns,
  expandDayRowsFromCsvRow,
  validateDuplicateSessionSlots
} = require('../lib/trainingPlanCsv.js');

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
        session_slot: 0,
        time_slot: null,
        week_target_tss: null,
        goals: [{ goal_type: 'goal_wattage', target_value: 180, unit: 'W', notes: null, sort_order: 0 }]
      }
    ]
  };

  const csv = serializePlanToCsv(plan);
  assert.ok(csv.includes('plan_name,start_date,status,total_weeks'), 'contains CSV headers');
  assert.ok(csv.includes('target_watts_min'), 'includes watt min column');
  const parsed = parsePlanCsv(csv);
  assert.strictEqual(parsed.name, plan.name, 'round-trips plan name');
  assert.strictEqual(parsed.start_date, plan.start_date, 'round-trips start date');
  assert.strictEqual(parsed.days.length, 1, 'round-trips day count');
  assert.strictEqual(parsed.days[0].label, 'Endurance Ride', 'round-trips day label');
  assert.strictEqual(parsed.days[0].session_slot, 0, 'session_slot defaults');
  assert.strictEqual(parsed.days[0].goals[0].goal_type, 'goal_wattage', 'round-trips goals_json');

  const rangeCsv =
    'plan_name,start_date,status,total_weeks,week_index,day_index,day_date,session_type,label,details,target_watts_label,target_watts_min,target_watts_max,am_session,pm_session,session_slot,time_slot,week_target_tss,phase_label,phase_code,goals_json\n' +
    'Range Plan,2026-05-04,active,1,0,0,2026-05-04,z2,Z2 Ride,,134-179W,134,179,,,0,,,Base,1,[]\n';
  const rangeParsed = parsePlanCsv(rangeCsv);
  const minGoal = rangeParsed.days[0].goals.find((g) => g.goal_type === 'goal_wattage_min');
  const maxGoal = rangeParsed.days[0].goals.find((g) => g.goal_type === 'goal_wattage_max');
  assert.strictEqual(minGoal.target_value, 134);
  assert.strictEqual(maxGoal.target_value, 179);

  const merged = mergeWattageGoalsFromColumns({
    goals: [],
    target_watts_min: 140,
    target_watts_max: 170
  });
  assert.strictEqual(merged.length, 2);

  const dualRow = {
    week_index: 0,
    day_index: 1,
    day_date: '2026-05-05',
    session_type: 'z2',
    label: 'Base Day',
    session_slot: 0,
    am_session: '90min Z2 AM',
    pm_session: '60min Z2 PM',
    goals: []
  };
  const expanded = expandDayRowsFromCsvRow(dualRow);
  assert.strictEqual(expanded.length, 2, 'splits legacy AM/PM row');
  assert.strictEqual(expanded[0].session_slot, 0);
  assert.strictEqual(expanded[1].session_slot, 1);
  assert.strictEqual(expanded[0].time_slot, 'am');
  assert.strictEqual(expanded[1].time_slot, 'pm');

  const amPmCsv =
    'plan_name,start_date,status,total_weeks,week_index,day_index,day_date,session_type,label,details,target_watts_label,target_watts_min,target_watts_max,am_session,pm_session,session_slot,time_slot,week_target_tss,phase_label,phase_code,goals_json\n' +
    'Dual,2026-05-04,active,1,0,1,2026-05-05,z2,Base,,,,90min AM,60min PM,0,,,Base,1,[]\n';
  const dualParsed = parsePlanCsv(amPmCsv);
  assert.strictEqual(dualParsed.days.length, 2, 'import expands AM/PM to two days');

  assert.throws(
    () =>
      validateDuplicateSessionSlots([
        { week_index: 0, day_index: 0, session_slot: 0 },
        { week_index: 0, day_index: 0, session_slot: 0 }
      ]),
    /Duplicate session_slot/
  );

  console.log('training-plan-csv tests: PASS');
}

run();
