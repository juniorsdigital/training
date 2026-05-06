'use strict';

function csvEscape(value) {
  const text = value == null ? '' : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  row.push(cell);
  if (!(row.length === 1 && row[0] === '' && rows.length === 0)) {
    rows.push(row);
  }
  return rows;
}

const CSV_HEADERS = [
  'plan_name',
  'start_date',
  'status',
  'total_weeks',
  'week_index',
  'day_index',
  'day_date',
  'session_type',
  'label',
  'details',
  'target_watts_label',
  'am_session',
  'pm_session',
  'phase_label',
  'phase_code',
  'goals_json'
];

function serializePlanToCsv(plan) {
  const p = plan || {};
  const days = Array.isArray(p.days) ? p.days : [];
  const rows = [CSV_HEADERS];
  days.forEach((day) => {
    rows.push([
      p.name || '',
      p.start_date || '',
      p.status || '',
      p.total_weeks == null ? '' : p.total_weeks,
      day.week_index == null ? '' : day.week_index,
      day.day_index == null ? '' : day.day_index,
      day.day_date || '',
      day.session_type || '',
      day.label || '',
      day.details || '',
      day.target_watts_label || '',
      day.am_session || '',
      day.pm_session || '',
      day.phase_label || '',
      day.phase_code || '',
      JSON.stringify(Array.isArray(day.goals) ? day.goals.map((g) => ({
        goal_type: g.goal_type || '',
        target_value: g.target_value == null || g.target_value === '' ? null : Number(g.target_value),
        unit: g.unit || null,
        notes: g.notes || null,
        sort_order: Number.isFinite(Number(g.sort_order)) ? Number(g.sort_order) : null
      })) : [])
    ]);
  });
  return `${toCsv(rows)}\n`;
}

function parsePlanCsv(text) {
  const rows = parseCsv(String(text || ''));
  if (!rows.length) throw new Error('CSV is empty.');
  const header = rows[0].map((v) => String(v || '').trim());
  const idx = new Map(header.map((name, pos) => [name, pos]));
  ['plan_name', 'start_date', 'week_index', 'day_index', 'day_date', 'session_type', 'label'].forEach((name) => {
    if (!idx.has(name)) throw new Error(`CSV missing required column: ${name}`);
  });
  const dataRows = rows.slice(1).filter((r) => r.some((v) => String(v || '').trim() !== ''));
  if (!dataRows.length) throw new Error('CSV has no day rows.');
  const first = dataRows[0];
  const pick = (r, key) => {
    const pos = idx.get(key);
    return pos == null ? '' : (r[pos] == null ? '' : String(r[pos]));
  };
  const plan = {
    name: pick(first, 'plan_name').trim(),
    start_date: pick(first, 'start_date').trim(),
    status: pick(first, 'status').trim() || 'active',
    total_weeks: Number.isFinite(Number(pick(first, 'total_weeks'))) ? Number(pick(first, 'total_weeks')) : null,
    days: []
  };
  if (!plan.name || !plan.start_date) {
    throw new Error('CSV requires plan_name and start_date.');
  }
  dataRows.forEach((r) => {
    const goalsRaw = pick(r, 'goals_json').trim();
    let goals = [];
    if (goalsRaw) {
      try {
        goals = JSON.parse(goalsRaw);
      } catch (error) {
        throw new Error('Invalid goals_json in CSV.');
      }
    }
    plan.days.push({
      week_index: Number(pick(r, 'week_index')),
      day_index: Number(pick(r, 'day_index')),
      day_date: pick(r, 'day_date').trim(),
      session_type: pick(r, 'session_type').trim(),
      label: pick(r, 'label').trim(),
      details: pick(r, 'details').trim() || null,
      target_watts_label: pick(r, 'target_watts_label').trim() || null,
      am_session: pick(r, 'am_session').trim() || null,
      pm_session: pick(r, 'pm_session').trim() || null,
      phase_label: pick(r, 'phase_label').trim() || null,
      phase_code: pick(r, 'phase_code').trim() || null,
      goals: Array.isArray(goals) ? goals : []
    });
  });
  return plan;
}

function templateCsvFromPlan(plan) {
  if (plan && Array.isArray(plan.days) && plan.days.length) {
    return serializePlanToCsv(plan);
  }
  return `${CSV_HEADERS.join(',')}\n`;
}

module.exports = {
  CSV_HEADERS,
  serializePlanToCsv,
  parsePlanCsv,
  templateCsvFromPlan
};
