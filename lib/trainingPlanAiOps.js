'use strict';

const crypto = require('crypto');

const ALLOWED_OPERATION_TYPES = new Set(['move_day_session', 'swap_day_sessions', 'update_day_notes']);

function cloneDaySnapshot(day) {
  const sessionSlot = Number(day?.session_slot);
  const weekTss = day?.week_target_tss;
  return {
    id: day.id,
    week_index: day.week_index,
    day_index: day.day_index,
    day_date: day.day_date,
    session_type: day.session_type,
    label: day.label,
    details: day.details,
    target_watts_label: day.target_watts_label,
    am_session: day.am_session,
    pm_session: day.pm_session,
    session_slot: Number.isInteger(sessionSlot) && sessionSlot >= 0 ? sessionSlot : 0,
    time_slot: day.time_slot ? String(day.time_slot).trim() : null,
    phase_label: day.phase_label ? String(day.phase_label) : null,
    phase_code: day.phase_code ? String(day.phase_code) : null,
    week_target_tss:
      weekTss === null || weekTss === undefined || weekTss === ''
        ? null
        : Number.isFinite(Number(weekTss))
          ? Number(weekTss)
          : null,
    goals: Array.isArray(day.goals) ? day.goals.map((goal) => ({ ...goal })) : []
  };
}

function normalizeText(value, maxLen = 1000) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function findDayBySelector(plan, selector, pointerLabel) {
  if (!selector || typeof selector !== 'object') {
    throw new Error(`${pointerLabel} selector is required.`);
  }
  const days = Array.isArray(plan?.days) ? plan.days : [];
  if (!days.length) throw new Error('Plan has no days to modify.');

  if (selector.day_id) {
    const byId = days.find((day) => String(day.id) === String(selector.day_id));
    if (!byId) throw new Error(`${pointerLabel} day_id not found.`);
    return byId;
  }

  const weekIndex = Number(selector.week_index);
  const dayIndex = Number(selector.day_index);
  if (!Number.isInteger(weekIndex) || weekIndex < 0) {
    throw new Error(`${pointerLabel}.week_index must be an integer >= 0.`);
  }
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) {
    throw new Error(`${pointerLabel}.day_index must be an integer between 0 and 6.`);
  }

  const matched = days.find(
    (day) => Number(day.week_index) === weekIndex && Number(day.day_index) === dayIndex
  );
  if (!matched) throw new Error(`${pointerLabel} day not found for week/day selector.`);
  return matched;
}

function normalizeOperation(plan, operation) {
  const type = String(operation?.type || '').trim();
  if (!ALLOWED_OPERATION_TYPES.has(type)) {
    throw new Error(`Unsupported operation type: ${type || 'unknown'}.`);
  }

  if (type === 'move_day_session') {
    const fromDay = findDayBySelector(plan, operation.from, 'from');
    const toDay = findDayBySelector(plan, operation.to, 'to');
    if (fromDay.id === toDay.id) {
      throw new Error('move_day_session requires different source and destination days.');
    }
    return {
      type,
      from_day_id: fromDay.id,
      to_day_id: toDay.id,
      reason: normalizeText(operation.reason, 280)
    };
  }

  if (type === 'swap_day_sessions') {
    const dayA = findDayBySelector(plan, operation.day_a, 'day_a');
    const dayB = findDayBySelector(plan, operation.day_b, 'day_b');
    if (dayA.id === dayB.id) {
      throw new Error('swap_day_sessions requires two distinct days.');
    }
    return {
      type,
      day_a_id: dayA.id,
      day_b_id: dayB.id,
      reason: normalizeText(operation.reason, 280)
    };
  }

  const targetDay = findDayBySelector(plan, operation.target, 'target');
  const notes = normalizeText(operation.notes, 2000);
  if (!notes) throw new Error('update_day_notes requires non-empty notes.');
  return {
    type,
    target_day_id: targetDay.id,
    notes,
    mode: operation.mode === 'append' ? 'append' : 'replace',
    reason: normalizeText(operation.reason, 280)
  };
}

function normalizeOperations(plan, operations, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  if (!Array.isArray(operations) || operations.length === 0) {
    if (allowEmpty) return [];
    throw new Error('At least one operation is required.');
  }
  return operations.map((operation) => normalizeOperation(plan, operation));
}

function getDayById(plan, id) {
  const day = (plan.days || []).find((entry) => String(entry.id) === String(id));
  if (!day) throw new Error(`Referenced day ${id} no longer exists.`);
  return day;
}

function transferSession(sourceDay, destinationDay) {
  destinationDay.session_type = sourceDay.session_type;
  destinationDay.label = sourceDay.label;
  destinationDay.details = sourceDay.details;
  destinationDay.target_watts_label = sourceDay.target_watts_label;
  destinationDay.am_session = sourceDay.am_session;
  destinationDay.pm_session = sourceDay.pm_session;
  destinationDay.time_slot = sourceDay.time_slot;
  destinationDay.goals = Array.isArray(sourceDay.goals) ? sourceDay.goals.map((goal) => ({ ...goal })) : [];
}

function clearToRest(day) {
  day.session_type = 'rest';
  day.label = 'REST';
  day.details = null;
  day.target_watts_label = null;
  day.am_session = null;
  day.pm_session = null;
  day.time_slot = null;
  day.goals = [];
}

function appendNotes(existing, additional) {
  const base = normalizeText(existing, 2000);
  const extra = normalizeText(additional, 2000);
  if (!base) return extra;
  if (!extra) return base;
  return `${base}\n\n${extra}`.slice(0, 2000);
}

function applyOperationsToPlan(plan, normalizedOperations) {
  const updatedPlan = {
    ...plan,
    days: (plan.days || []).map((day) => ({
      ...day,
      goals: Array.isArray(day.goals) ? day.goals.map((goal) => ({ ...goal })) : []
    }))
  };

  normalizedOperations.forEach((operation) => {
    if (operation.type === 'move_day_session') {
      const fromDay = getDayById(updatedPlan, operation.from_day_id);
      const toDay = getDayById(updatedPlan, operation.to_day_id);
      transferSession(fromDay, toDay);
      clearToRest(fromDay);
      return;
    }

    if (operation.type === 'swap_day_sessions') {
      const dayA = getDayById(updatedPlan, operation.day_a_id);
      const dayB = getDayById(updatedPlan, operation.day_b_id);
      const snapshotA = cloneDaySnapshot(dayA);
      transferSession(dayB, dayA);
      transferSession(snapshotA, dayB);
      return;
    }

    const targetDay = getDayById(updatedPlan, operation.target_day_id);
    if (operation.mode === 'append') {
      targetDay.details = appendNotes(targetDay.details, operation.notes);
    } else {
      targetDay.details = operation.notes;
    }
  });

  return updatedPlan;
}

function collectImpactedDayIds(normalizedOperations) {
  const impacted = new Set();
  normalizedOperations.forEach((operation) => {
    if (operation.type === 'move_day_session') {
      impacted.add(String(operation.from_day_id));
      impacted.add(String(operation.to_day_id));
      return;
    }
    if (operation.type === 'swap_day_sessions') {
      impacted.add(String(operation.day_a_id));
      impacted.add(String(operation.day_b_id));
      return;
    }
    impacted.add(String(operation.target_day_id));
  });
  return Array.from(impacted.values());
}

function buildPreview(plan, normalizedOperations) {
  if (!normalizedOperations.length) {
    return { affected_days: [], operation_count: 0 };
  }
  const beforeById = new Map((plan.days || []).map((day) => [String(day.id), cloneDaySnapshot(day)]));
  const updatedPlan = applyOperationsToPlan(plan, normalizedOperations);
  const afterById = new Map((updatedPlan.days || []).map((day) => [String(day.id), cloneDaySnapshot(day)]));
  const impactedIds = collectImpactedDayIds(normalizedOperations);
  const affected_days = impactedIds.map((id) => ({
    day_id: id,
    before: beforeById.get(String(id)) || null,
    after: afterById.get(String(id)) || null
  }));
  return {
    affected_days,
    operation_count: normalizedOperations.length
  };
}

function createProposalHash(plan, normalizedOperations) {
  const stable = JSON.stringify({
    plan_id: plan?.id || null,
    plan_version: Number(plan?.version || 0),
    operations: normalizedOperations
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}

function summarizeOperations(normalizedOperations) {
  const moveCount = normalizedOperations.filter((op) => op.type === 'move_day_session').length;
  const swapCount = normalizedOperations.filter((op) => op.type === 'swap_day_sessions').length;
  const notesCount = normalizedOperations.filter((op) => op.type === 'update_day_notes').length;
  return {
    move_count: moveCount,
    swap_count: swapCount,
    notes_count: notesCount
  };
}

module.exports = {
  ALLOWED_OPERATION_TYPES,
  normalizeOperations,
  applyOperationsToPlan,
  collectImpactedDayIds,
  buildPreview,
  createProposalHash,
  summarizeOperations,
  transferSession,
  clearToRest,
  cloneDaySnapshot
};
