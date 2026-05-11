'use strict';

const { requestJson, supabaseHeaders } = require('./supabaseRest.js');

const EXPORT_FORMAT_VERSION = '1.0.0';

function asIsoDate(value) {
  return String(value || '').slice(0, 10);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function parseBody(req) {
  let body = req.body;
  if (typeof body === 'string') {
    body = JSON.parse(body);
  }
  return body || {};
}

const VALID_PHASE_CODES = new Set(['0', '1', '2', '3', '4', 'T', 'F']);

function inferPhaseCode(phaseLabel, phaseCode) {
  const c = String(phaseCode || '').trim();
  if (VALID_PHASE_CODES.has(c)) return c;
  const L = String(phaseLabel || '').toLowerCase();
  if (/testing|^0[\s–-]/.test(L)) return '0';
  if (/transition|→|to\s*4/.test(L)) return 'T';
  if (/final/.test(L)) return 'F';
  if (/polar/.test(L)) return '2';
  if (/peak\s*power/.test(L) || /^3[\s–-]/.test(L)) return '3';
  if (/sprint/.test(L) || /^4[\s–-]/.test(L)) return '4';
  if (/ss\s*base|sweet\s*spot/.test(L)) return '1';
  return '1';
}

function cleanPlanLabel(value) {
  if (value == null) return '';
  const t = String(value).trim();
  if (!t || t === '?') return '';
  return t;
}

function weekTssFromGoals(goals) {
  if (!Array.isArray(goals)) return null;
  const match = goals.find(
    (g) =>
      g &&
      (String(g.goal_type || '').toLowerCase() === 'goal_tss_week' ||
        String(g.goal_type || '').toLowerCase() === 'tss_week')
  );
  if (!match || match.target_value == null) return null;
  const n = Number(match.target_value);
  return Number.isFinite(n) ? n : null;
}

function mergePlanDayRows(rows) {
  const sorted = [...rows].sort((a, b) => (Number(a.session_slot) || 0) - (Number(b.session_slot) || 0));
  const labels = [];
  const details = [];
  const goalChunks = [];
  const types = [];
  const watts = [];
  const amParts = [];
  const pmParts = [];

  sorted.forEach((d) => {
    const ts = String(d.time_slot || '').trim().toLowerCase();
    labels.push(cleanPlanLabel(d.label));
    types.push(String(d.session_type || 'rest'));
    if (d.details) details.push(String(d.details));
    const gt = (d.goals || [])
      .map((g) =>
        `${g.goal_type}${g.target_value != null ? `: ${g.target_value}${g.unit ? ` ${g.unit}` : ''}` : ''}${g.notes ? ` (${g.notes})` : ''}`
      )
      .join(' | ');
    if (gt) goalChunks.push(gt);
    if (d.target_watts_label) watts.push(String(d.target_watts_label));
    const am = d.am_session ? String(d.am_session).trim() : '';
    const pm = d.pm_session ? String(d.pm_session).trim() : '';
    if (ts === 'am') {
      if (am) amParts.push(am);
      else if (cleanPlanLabel(d.label)) amParts.push(cleanPlanLabel(d.label));
    } else if (ts === 'pm') {
      if (pm) pmParts.push(pm);
      else if (cleanPlanLabel(d.label)) pmParts.push(cleanPlanLabel(d.label));
    } else {
      if (am) amParts.push(am);
      if (pm && pm !== '—') pmParts.push(pm);
    }
  });

  const t = types.find((x) => x && x !== 'rest') || 'rest';
  const lblJoin = labels.filter(Boolean).join(' · ');
  const lbl = lblJoin || (t === 'rest' ? 'REST' : '');
  const det = [details.join('\n'), goalChunks.length ? `Goals: ${goalChunks.join(' | ')}` : ''].filter(Boolean).join('\n');
  return {
    t,
    lbl: lbl || '',
    det,
    w: watts[0] || null,
    am: amParts.length ? amParts.join('; ') : null,
    pm: pmParts.length ? pmParts.join('; ') : null
  };
}

function synthesizeMissingWeeks(weekArr, totalWeeks) {
  const tw = Number(totalWeeks);
  if (!Number.isFinite(tw) || tw < 1) return weekArr;
  const byWk = new Map(weekArr.map((w) => [w.wk, w]));
  const out = [];
  for (let n = 1; n <= tw; n++) {
    if (byWk.has(n)) {
      out.push(byWk.get(n));
    } else {
      const prev = out[out.length - 1];
      out.push({
        wk: n,
        phase: prev ? prev.phase : 'Plan',
        pCode: prev ? prev.pCode : '1',
        tss: prev && prev.tss != null ? prev.tss : null,
        days: new Array(7).fill(null).map(() => ({
          t: 'rest',
          lbl: '',
          det: '',
          w: null,
          am: null,
          pm: null
        }))
      });
    }
  }
  return out;
}

function validGoalType(value) {
  return /^[a-z0-9_:-]{2,40}$/i.test(String(value || ''));
}

function normalizeGoal(goal, idx) {
  const goalType = String(goal?.goal_type || '').trim();
  if (!validGoalType(goalType)) {
    throw new Error('Each goal must include a valid goal_type.');
  }
  const target =
    goal?.target_value === null || goal?.target_value === undefined || goal?.target_value === ''
      ? null
      : Number(goal.target_value);
  if (target !== null && Number.isNaN(target)) {
    throw new Error(`Invalid target_value for goal_type=${goalType}.`);
  }
  return {
    goal_type: goalType,
    target_value: target,
    unit: goal?.unit ? String(goal.unit).trim().slice(0, 24) : null,
    notes: goal?.notes ? String(goal.notes).trim().slice(0, 280) : null,
    sort_order: Number.isFinite(Number(goal?.sort_order)) ? Number(goal.sort_order) : idx
  };
}

async function listPlans() {
  const data = await requestJson('/training_plans?select=*&order=updated_at.desc');
  return Array.isArray(data) ? data : [];
}

async function getPlanById(planId) {
  const plans = await requestJson(`/training_plans?id=eq.${encodeURIComponent(planId)}&select=*`);
  if (!Array.isArray(plans) || plans.length === 0) return null;
  const plan = plans[0];
  const days = await requestJson(
    `/training_plan_days?plan_id=eq.${encodeURIComponent(planId)}&select=*&order=week_index.asc,day_index.asc`
  );
  const dayIds = (Array.isArray(days) ? days : []).map((d) => d.id);
  let goals = [];
  if (dayIds.length) {
    const encoded = `(${dayIds.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;
    goals = await requestJson(
      `/training_plan_day_goals?plan_day_id=in.${encodeURIComponent(encoded)}&select=*&order=sort_order.asc`
    );
  }
  const goalsByDay = new Map();
  (Array.isArray(goals) ? goals : []).forEach((g) => {
    const list = goalsByDay.get(g.plan_day_id) || [];
    list.push(g);
    goalsByDay.set(g.plan_day_id, list);
  });
  return {
    ...plan,
    days: (Array.isArray(days) ? days : []).map((d) => ({ ...d, goals: goalsByDay.get(d.id) || [] }))
  };
}

async function getCanonicalPlan() {
  const plans = await listPlans();
  if (!plans.length) return null;
  return getPlanById(plans[0].id);
}

async function upsertPlan(input) {
  const name = String(input?.name || '').trim();
  const startDate = asIsoDate(input?.start_date);
  if (!name) throw new Error('name is required.');
  if (!isIsoDate(startDate)) throw new Error('start_date must be YYYY-MM-DD.');
  const payload = {
    id: input?.id || undefined,
    name,
    status: input?.status || 'draft',
    version: Number.isFinite(Number(input?.version)) ? Number(input.version) : 1,
    start_date: startDate,
    total_weeks: Number.isFinite(Number(input?.total_weeks)) ? Number(input.total_weeks) : null,
    source: input?.source ? String(input.source).slice(0, 40) : null,
    updated_at: new Date().toISOString()
  };
  if (!payload.id) delete payload.id;
  const data = await requestJson('/training_plans', {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(payload)
  });
  return Array.isArray(data) ? data[0] : data;
}

async function replaceDayGoals(planDayId, goals) {
  const normalized = (Array.isArray(goals) ? goals : []).map(normalizeGoal);
  await requestJson(`/training_plan_day_goals?plan_day_id=eq.${encodeURIComponent(planDayId)}`, {
    method: 'DELETE',
    headers: supabaseHeaders()
  });
  if (!normalized.length) return [];
  const inserted = await requestJson('/training_plan_day_goals', {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(normalized.map((g) => ({ ...g, plan_day_id: planDayId })))
  });
  return Array.isArray(inserted) ? inserted : [];
}

async function upsertPlanDay(planId, day) {
  const sessionSlot = Number.isInteger(Number(day?.session_slot)) ? Number(day.session_slot) : 0;
  const weekTss =
    day?.week_target_tss === null || day?.week_target_tss === undefined || day?.week_target_tss === ''
      ? null
      : Number(day.week_target_tss);
  const payload = {
    id: day?.id || undefined,
    plan_id: planId,
    week_index: Number(day?.week_index),
    day_index: Number(day?.day_index),
    day_date: asIsoDate(day?.day_date),
    session_type: String(day?.session_type || 'rest').slice(0, 24),
    label: String(day?.label || '').slice(0, 160),
    details: day?.details ? String(day.details) : null,
    target_watts_label: day?.target_watts_label ? String(day.target_watts_label).slice(0, 120) : null,
    am_session: day?.am_session ? String(day.am_session).slice(0, 240) : null,
    pm_session: day?.pm_session ? String(day.pm_session).slice(0, 240) : null,
    phase_label: day?.phase_label ? String(day.phase_label).slice(0, 120) : null,
    phase_code: day?.phase_code ? String(day.phase_code).slice(0, 16) : null,
    session_slot: sessionSlot,
    time_slot: day?.time_slot ? String(day.time_slot).trim().slice(0, 8) || null : null,
    week_target_tss: weekTss != null && Number.isFinite(weekTss) ? weekTss : null,
    updated_at: new Date().toISOString()
  };
  if (!isIsoDate(payload.day_date)) throw new Error('day_date must be YYYY-MM-DD.');
  if (!Number.isInteger(payload.week_index) || payload.week_index < 0) throw new Error('week_index is required.');
  if (!Number.isInteger(payload.day_index) || payload.day_index < 0 || payload.day_index > 6) {
    throw new Error('day_index must be 0..6.');
  }
  if (!Number.isInteger(payload.session_slot) || payload.session_slot < 0) {
    throw new Error('session_slot must be a non-negative integer.');
  }
  if (!payload.id) delete payload.id;
  const inserted = await requestJson('/training_plan_days', {
    method: 'POST',
    headers: supabaseHeaders({ Prefer: 'resolution=merge-duplicates,return=representation' }),
    body: JSON.stringify(payload)
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  const goals = await replaceDayGoals(row.id, day?.goals || []);
  return { ...row, goals };
}

async function replacePlanDays(planId, incomingDays) {
  await requestJson(`/training_plan_days?plan_id=eq.${encodeURIComponent(planId)}`, {
    method: 'DELETE',
    headers: supabaseHeaders()
  });
  const savedDays = [];
  for (const day of Array.isArray(incomingDays) ? incomingDays : []) {
    const cleanDay = { ...day };
    delete cleanDay.id;
    const saved = await upsertPlanDay(planId, cleanDay);
    savedDays.push(saved);
  }
  return savedDays;
}

async function overwriteCanonicalPlan(incomingPlan) {
  const incoming = incomingPlan || {};
  const name = String(incoming.name || '').trim();
  const startDate = asIsoDate(incoming.start_date);
  if (!name) throw new Error('plan.name is required.');
  if (!isIsoDate(startDate)) throw new Error('plan.start_date must be YYYY-MM-DD.');

  const existing = await getCanonicalPlan();
  const canonical = await upsertPlan({
    id: existing?.id,
    name,
    start_date: startDate,
    status: String(incoming.status || existing?.status || 'draft').slice(0, 24),
    version: existing ? Number(existing.version || 1) + 1 : Number(incoming.version) || 1,
    total_weeks: Number.isFinite(Number(incoming.total_weeks)) ? Number(incoming.total_weeks) : null,
    source: 'import-overwrite'
  });
  await replacePlanDays(canonical.id, incoming.days || []);
  return getPlanById(canonical.id);
}

function mapPlanToLegacyWeeks(plan) {
  const groups = new Map();
  (plan.days || []).forEach((day) => {
    const key = `${Number(day.week_index)}-${Number(day.day_index)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(day);
  });

  const byWeek = new Map();
  groups.forEach((rows) => {
    const first = rows[0];
    const weekNum = Number(first.week_index) + 1;
    const di = Number(first.day_index);
    const merged = mergePlanDayRows(rows);

    if (!byWeek.has(weekNum)) {
      byWeek.set(weekNum, {
        wk: weekNum,
        phase: first.phase_label || `Plan Week ${weekNum}`,
        pCode: inferPhaseCode(first.phase_label, first.phase_code),
        tss: null,
        days: new Array(7).fill(null)
      });
    }
    const wk = byWeek.get(weekNum);
    if (first.phase_label) wk.phase = first.phase_label;
    wk.pCode = inferPhaseCode(first.phase_label, first.phase_code);

    wk.days[di] = merged;
  });

  const tssByWeek = new Map();
  (plan.days || []).forEach((d) => {
    const wn = Number(d.week_index) + 1;
    const wt =
      d.week_target_tss === null || d.week_target_tss === undefined || d.week_target_tss === ''
        ? null
        : Number(d.week_target_tss);
    if (wt != null && Number.isFinite(wt)) tssByWeek.set(wn, wt);
  });
  const goalsByWeek = new Map();
  (plan.days || []).forEach((d) => {
    const wn = Number(d.week_index) + 1;
    const list = goalsByWeek.get(wn) || [];
    list.push(...(d.goals || []));
    goalsByWeek.set(wn, list);
  });
  goalsByWeek.forEach((goals, wn) => {
    if (tssByWeek.has(wn)) return;
    const g = weekTssFromGoals(goals);
    if (g != null) tssByWeek.set(wn, g);
  });
  byWeek.forEach((wk, wn) => {
    if (tssByWeek.has(wn)) wk.tss = tssByWeek.get(wn);
  });

  let weeks = Array.from(byWeek.values()).sort((a, b) => a.wk - b.wk);
  weeks = weeks.map((wk) => ({
    ...wk,
    days: wk.days.map((d) =>
      d && typeof d === 'object'
        ? d
        : { t: 'rest', lbl: '', det: '', w: null, am: null, pm: null }
    )
  }));
  weeks = synthesizeMissingWeeks(weeks, plan?.total_weeks);
  weeks.forEach((wk) => {
    if (tssByWeek.has(wk.wk)) wk.tss = tssByWeek.get(wk.wk);
  });
  return weeks;
}

function buildExportDocument(plan) {
  return {
    documentation: {
      title: 'Training Plan Export Format',
      format_version: EXPORT_FORMAT_VERSION,
      required_fields: ['plan.name', 'plan.start_date', 'days[].week_index', 'days[].day_index', 'days[].day_date', 'days[].session_type', 'days[].label'],
      goal_types: {
        description: 'Typed goals attached to each workout day.',
        fields: ['goal_type', 'target_value', 'unit', 'notes', 'sort_order'],
        examples: [
          { goal_type: 'goal_wattage', target_value: 240, unit: 'W', notes: 'Sustained target for threshold block' },
          { goal_type: 'goal_heart_rate', target_value: 165, unit: 'bpm', notes: 'Stay under cap' },
          { goal_type: 'goal_adaptation', target_value: null, unit: null, notes: 'Neuromuscular sprint adaptation' }
        ]
      },
      import_validation_rules: [
        'goal_type must be 2-40 chars [a-z0-9_:-].',
        'target_value may be null or numeric.',
        'day_index must be 0..6.',
        'day_date must be ISO date (YYYY-MM-DD).'
      ],
      import_mode: 'overwrite-canonical',
      import_notes: [
        'Import replaces the canonical plan metadata and all existing day records.',
        'Export first, then edit the exported file to preserve schema compatibility.'
      ]
    },
    exported_at: new Date().toISOString(),
    plan
  };
}

module.exports = {
  EXPORT_FORMAT_VERSION,
  parseBody,
  listPlans,
  getPlanById,
  getCanonicalPlan,
  upsertPlan,
  upsertPlanDay,
  replaceDayGoals,
  replacePlanDays,
  overwriteCanonicalPlan,
  mapPlanToLegacyWeeks,
  buildExportDocument,
  inferPhaseCode,
  mergePlanDayRows,
  synthesizeMissingWeeks
};
