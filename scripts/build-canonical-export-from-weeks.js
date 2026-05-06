#!/usr/bin/env node
'use strict';

/**
 * Builds a training plan JSON file matching GET /api/training-plans?mode=export
 * (buildExportDocument in lib/trainingPlanService.js).
 *
 * Input: legacy weeks array — same shape as WEEKS in index.html.
 * Keep data/legacy-weeks.json in sync with index.html when the embedded fallback changes.
 *
 * Usage:
 *   node scripts/build-canonical-export-from-weeks.js [path/to/legacy-weeks.json]
 *   node scripts/build-canonical-export-from-weeks.js --out training-plan-canonical.json
 *
 * Upload: Plan Editor → Import and Overwrite Plan (overwrites canonical plan in DB).
 */

const fs = require('fs');
const path = require('path');
const { buildExportDocument } = require('../lib/trainingPlanService.js');

function addDays(startDate, offset) {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function legacyWeeksToPlan(weeks, options = {}) {
  const startDate = options.startDate || '2026-05-04';
  const name = options.name || 'Legacy Imported Training Plan';
  if (!Array.isArray(weeks) || !weeks.length) {
    throw new Error('weeks must be a non-empty array.');
  }
  const days = [];
  for (let w = 0; w < weeks.length; w += 1) {
    const week = weeks[w];
    for (let d = 0; d < 7; d += 1) {
      const day = week.days?.[d] || {};
      days.push({
        week_index: w,
        day_index: d,
        day_date: addDays(startDate, w * 7 + d),
        session_type: day.t || 'rest',
        label: day.lbl || 'REST',
        details: day.det || '',
        target_watts_label: day.w || null,
        am_session: day.am || null,
        pm_session: day.pm || null,
        phase_label: week.phase || null,
        phase_code: week.pCode || null,
        goals: []
      });
    }
  }
  return {
    name,
    start_date: startDate,
    status: 'active',
    version: 1,
    total_weeks: weeks.length,
    source: 'legacy-weeks-export',
    days
  };
}

function parseArgs(argv) {
  const args = { out: null, startDate: null, name: null, weeksPath: null };
  const rest = [];
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--out' && argv[i + 1]) {
      args.out = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--start-date' && argv[i + 1]) {
      args.startDate = argv[i + 1];
      i += 1;
    } else if (argv[i] === '--name' && argv[i + 1]) {
      args.name = argv[i + 1];
      i += 1;
    } else if (!argv[i].startsWith('-')) {
      rest.push(argv[i]);
    }
  }
  args.weeksPath = rest[0] || path.join(__dirname, '..', 'data', 'legacy-weeks.json');
  return args;
}

function main() {
  const { out, startDate, name, weeksPath } = parseArgs(process.argv);
  const raw = fs.readFileSync(weeksPath, 'utf8');
  const weeks = JSON.parse(raw);
  const plan = legacyWeeksToPlan(weeks, { startDate, name });
  const doc = buildExportDocument(plan);
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (out) {
    fs.writeFileSync(out, text);
    process.stderr.write(`Wrote ${out}\n`);
  } else {
    process.stdout.write(text);
  }
}

main();
