'use strict';

function normalizeDateValue(value) {
  const s = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(s)) return s.slice(0, 10).replace(/\//g, '-');
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) return `${slash[3]}-${slash[1].padStart(2, '0')}-${slash[2].padStart(2, '0')}`;
  const dash = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dash) return `${dash[3]}-${dash[1].padStart(2, '0')}-${dash[2].padStart(2, '0')}`;
  return s;
}

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
  'target_watts_min',
  'target_watts_max',
  'am_session',
  'pm_session',
  'session_slot',
  'time_slot',
  'week_target_tss',
  'phase_label',
  'phase_code',
  'goals_json'
];

function goalValueFromGoals(goals, type) {
  const g = (Array.isArray(goals) ? goals : []).find(
    (x) => String(x?.goal_type || '').toLowerCase() === String(type).toLowerCase()
  );
  if (!g || g.target_value == null || g.target_value === '') return null;
  const n = Number(g.target_value);
  return Number.isFinite(n) ? n : null;
}

function isMeaningfulSessionText(value) {
  const t = String(value || '').trim();
  return t !== '' && t !== '—' && t !== '-';
}

function expandDayRowsFromCsvRow(day) {
  const slot = Number(day.session_slot) || 0;
  const st = String(day.session_type || 'rest').toLowerCase();
  const am = isMeaningfulSessionText(day.am_session);
  const pm = isMeaningfulSessionText(day.pm_session);
  if (slot !== 0 || st === 'rest' || !am || !pm) {
    return [day];
  }
  const base = { ...day, goals: Array.isArray(day.goals) ? [...day.goals] : [] };
  return [
    {
      ...base,
      session_slot: 0,
      time_slot: 'am',
      am_session: day.am_session,
      pm_session: null,
      label: String(day.label || day.am_session || '').trim() || day.am_session
    },
    {
      ...base,
      session_slot: 1,
      time_slot: 'pm',
      am_session: null,
      pm_session: day.pm_session,
      label: String(day.pm_session || day.label || '').trim() || day.pm_session
    }
  ];
}

function validateDuplicateSessionSlots(days) {
  const seen = new Map();
  (Array.isArray(days) ? days : []).forEach((day, rowIndex) => {
    const key = `${Number(day.week_index)}-${Number(day.day_index)}-${Number.isInteger(Number(day.session_slot)) ? Number(day.session_slot) : 0}`;
    if (seen.has(key)) {
      const prev = seen.get(key);
      throw new Error(
        `Duplicate session_slot ${day.session_slot ?? 0} for week_index=${day.week_index}, day_index=${day.day_index} (CSV rows ${prev} and ${rowIndex + 2}).`
      );
    }
    seen.set(key, rowIndex + 2);
  });
}

function normalizeImportedPlanDays(days) {
  const expanded = [];
  (Array.isArray(days) ? days : []).forEach((day) => {
    expandDayRowsFromCsvRow(day).forEach((row) => expanded.push(row));
  });
  validateDuplicateSessionSlots(expanded);
  return expanded;
}

function mergeWattageGoalsFromColumns(day) {
  const goals = Array.isArray(day.goals) ? [...day.goals] : [];
  const minCol = day.target_watts_min;
  const maxCol = day.target_watts_max;
  const hasMin = minCol != null && minCol !== '' && Number.isFinite(Number(minCol));
  const hasMax = maxCol != null && maxCol !== '' && Number.isFinite(Number(maxCol));

  const withoutRange = goals.filter((g) => {
    const t = String(g.goal_type || '').toLowerCase();
    return t !== 'goal_wattage_min' && t !== 'goal_wattage_max' && t !== 'goal_wattage';
  });

  if (hasMin && hasMax) {
    withoutRange.push(
      { goal_type: 'goal_wattage_min', target_value: Number(minCol), unit: 'W', notes: null, sort_order: 1 },
      { goal_type: 'goal_wattage_max', target_value: Number(maxCol), unit: 'W', notes: null, sort_order: 2 }
    );
    return withoutRange;
  }

  const gMin = goalValueFromGoals(goals, 'goal_wattage_min');
  const gMax = goalValueFromGoals(goals, 'goal_wattage_max');
  if (gMin != null && gMax != null) return goals;

  return goals;
}

function serializePlanToCsv(plan) {
  const p = plan || {};
  const days = Array.isArray(p.days) ? p.days : [];
  const rows = [CSV_HEADERS];
  days.forEach((day) => {
    const goals = Array.isArray(day.goals) ? day.goals : [];
    const wMin = goalValueFromGoals(goals, 'goal_wattage_min');
    const wMax = goalValueFromGoals(goals, 'goal_wattage_max');
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
      wMin != null ? wMin : '',
      wMax != null ? wMax : '',
      day.am_session || '',
      day.pm_session || '',
      day.session_slot == null ? '' : day.session_slot,
      day.time_slot || '',
      day.week_target_tss == null ? '' : day.week_target_tss,
      day.phase_label || '',
      day.phase_code || '',
      JSON.stringify(goals.map((g) => ({
        goal_type: g.goal_type || '',
        target_value: g.target_value == null || g.target_value === '' ? null : Number(g.target_value),
        unit: g.unit || null,
        notes: g.notes || null,
        sort_order: Number.isFinite(Number(g.sort_order)) ? Number(g.sort_order) : null
      })))
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
    start_date: normalizeDateValue(pick(first, 'start_date')),
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
    const slotRaw = pick(r, 'session_slot').trim();
    const sessionSlot = slotRaw === '' ? 0 : Number(slotRaw);
    const weekTssRaw = pick(r, 'week_target_tss').trim();
    const weekTargetTss =
      weekTssRaw === '' ? null : Number(weekTssRaw);
    const minRaw = pick(r, 'target_watts_min').trim();
    const maxRaw = pick(r, 'target_watts_max').trim();
    const targetWattsMin = minRaw === '' ? null : Number(minRaw);
    const targetWattsMax = maxRaw === '' ? null : Number(maxRaw);

    const day = {
      week_index: Number(pick(r, 'week_index')),
      day_index: Number(pick(r, 'day_index')),
      day_date: normalizeDateValue(pick(r, 'day_date')),
      session_type: pick(r, 'session_type').trim(),
      label: pick(r, 'label').trim(),
      details: pick(r, 'details').trim() || null,
      target_watts_label: pick(r, 'target_watts_label').trim() || null,
      target_watts_min:
        targetWattsMin != null && Number.isFinite(targetWattsMin) ? targetWattsMin : null,
      target_watts_max:
        targetWattsMax != null && Number.isFinite(targetWattsMax) ? targetWattsMax : null,
      am_session: pick(r, 'am_session').trim() || null,
      pm_session: pick(r, 'pm_session').trim() || null,
      session_slot: Number.isInteger(sessionSlot) && sessionSlot >= 0 ? sessionSlot : 0,
      time_slot: pick(r, 'time_slot').trim() || null,
      week_target_tss:
        weekTargetTss != null && Number.isFinite(weekTargetTss) ? weekTargetTss : null,
      phase_label: pick(r, 'phase_label').trim() || null,
      phase_code: pick(r, 'phase_code').trim() || null,
      goals: Array.isArray(goals) ? goals : []
    };
    day.goals = mergeWattageGoalsFromColumns(day);
    plan.days.push(day);
  });
  plan.days = normalizeImportedPlanDays(plan.days);
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
  templateCsvFromPlan,
  mergeWattageGoalsFromColumns,
  goalValueFromGoals,
  isMeaningfulSessionText,
  expandDayRowsFromCsvRow,
  validateDuplicateSessionSlots,
  normalizeImportedPlanDays
};
