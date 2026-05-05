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
    updated_at: new Date().toISOString()
  };
  if (!isIsoDate(payload.day_date)) throw new Error('day_date must be YYYY-MM-DD.');
  if (!Number.isInteger(payload.week_index) || payload.week_index < 0) throw new Error('week_index is required.');
  if (!Number.isInteger(payload.day_index) || payload.day_index < 0 || payload.day_index > 6) {
    throw new Error('day_index must be 0..6.');
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

function mapPlanToLegacyWeeks(plan) {
  const byWeek = new Map();
  (plan.days || []).forEach((day) => {
    const weekNum = Number(day.week_index) + 1;
    if (!byWeek.has(weekNum)) {
      byWeek.set(weekNum, {
        wk: weekNum,
        phase: day.phase_label || `Plan Week ${weekNum}`,
        pCode: day.phase_code || '1',
        tss: null,
        days: new Array(7).fill(null)
      });
    }
    const goalsText = (day.goals || [])
      .map((g) => `${g.goal_type}${g.target_value != null ? `: ${g.target_value}${g.unit ? ` ${g.unit}` : ''}` : ''}${g.notes ? ` (${g.notes})` : ''}`)
      .join(' | ');
    byWeek.get(weekNum).days[Number(day.day_index)] = {
      t: day.session_type || 'rest',
      lbl: day.label || 'Workout',
      det: [day.details, goalsText ? `Goals: ${goalsText}` : null].filter(Boolean).join('\n'),
      w: day.target_watts_label || null,
      am: day.am_session || null,
      pm: day.pm_session || null
    };
  });
  return Array.from(byWeek.values())
    .sort((a, b) => a.wk - b.wk)
    .map((wk) => ({
      ...wk,
      days: wk.days.map((d) => d || { t: 'rest', lbl: 'REST', det: '', w: null, am: null, pm: null })
    }));
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
  upsertPlan,
  upsertPlanDay,
  replaceDayGoals,
  mapPlanToLegacyWeeks,
  buildExportDocument
};
