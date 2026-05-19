'use strict';

const DEFAULT_FTP = 239;
const IF_MIN = 0.5;
const IF_MAX = 1.15;

const ZONE_IF = {
  rest: 0,
  z1: 0.55,
  z2: 0.65,
  ride: 0.65,
  ss: 0.88,
  thr: 0.95,
  vo2: 1.02,
  spr: 1.02,
  ana: 1.02,
  strength: 0.55,
  test: 0.9,
  tst: 0.9
};

function clampIf(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(IF_MAX, Math.max(IF_MIN, n));
}

function defaultIfForSessionType(sessionType) {
  const key = String(sessionType || 'rest').trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ZONE_IF, key)) return ZONE_IF[key];
  return ZONE_IF.z2;
}

function parseWatts(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const m = String(value).match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const parsed = Number(m[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function goalByType(goals, type) {
  const want = String(type || '').toLowerCase();
  return (Array.isArray(goals) ? goals : []).find((g) => String(g?.goal_type || '').toLowerCase() === want);
}

function goalValue(goals, type) {
  const g = goalByType(goals, type);
  if (!g || g.target_value == null || g.target_value === '') return null;
  const n = Number(g.target_value);
  return Number.isFinite(n) ? n : null;
}

function isManualTssGoal(goal) {
  if (!goal) return false;
  const notes = String(goal.notes || '').toLowerCase();
  return notes.includes('source:manual');
}

/**
 * TSS ≈ hours × IF² × 100
 */
function tssFromDurationAndIf(durationMin, intensityFactor) {
  const minutes = Number(durationMin);
  const ifVal = Number(intensityFactor);
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (!Number.isFinite(ifVal) || ifVal <= 0) return null;
  const hours = minutes / 60;
  return Math.round(hours * ifVal * ifVal * 100);
}

/**
 * @param {{
 *   sessionType?: string,
 *   durationMin?: number|null,
 *   ftp?: number,
 *   watts?: number|null,
 *   manualTss?: number|null,
 *   explicitIf?: number|null,
 *   goals?: array
 * }} params
 */
function estimateProjectedTss(params) {
  const warnings = [];
  const sessionType = String(params?.sessionType || 'rest').trim().toLowerCase();
  const ftp = Number(params?.ftp);
  const safeFtp = Number.isFinite(ftp) && ftp > 0 ? ftp : DEFAULT_FTP;
  const goals = params?.goals;

  let manualTss = params?.manualTss;
  if (manualTss == null && goals) {
    const manualGoal = goalByType(goals, 'goal_tss');
    if (manualGoal && isManualTssGoal(manualGoal)) {
      manualTss = goalValue(goals, 'goal_tss');
    }
  }
  if (manualTss != null && Number.isFinite(Number(manualTss))) {
    return {
      tss: Math.round(Number(manualTss)),
      ifUsed: null,
      source: 'manual',
      warnings
    };
  }

  if (sessionType === 'rest') {
    return { tss: 0, ifUsed: 0, source: 'zone', warnings };
  }

  let durationMin = params?.durationMin;
  if (durationMin == null && goals) durationMin = goalValue(goals, 'goal_duration_min');
  if (durationMin == null || !Number.isFinite(Number(durationMin)) || Number(durationMin) <= 0) {
    return { tss: null, ifUsed: null, source: null, warnings: ['duration required'] };
  }
  durationMin = Number(durationMin);

  let watts = params?.watts;
  if (watts == null && goals) watts = goalValue(goals, 'goal_wattage');
  if (watts == null && params?.targetWattsLabel) watts = parseWatts(params.targetWattsLabel);

  if (watts != null) {
    const ifUsed = clampIf(watts / safeFtp);
    const tss = tssFromDurationAndIf(durationMin, ifUsed);
    return { tss, ifUsed, source: 'watts', warnings };
  }

  let explicitIf = params?.explicitIf;
  if (explicitIf == null && goals) explicitIf = goalValue(goals, 'goal_if');
  if (explicitIf != null) {
    const ifUsed = clampIf(explicitIf);
    const tss = tssFromDurationAndIf(durationMin, ifUsed);
    return { tss, ifUsed, source: 'if', warnings };
  }

  const autoGoal = goalByType(goals, 'goal_tss');
  if (autoGoal && !isManualTssGoal(autoGoal)) {
    const stored = goalValue(goals, 'goal_tss');
    if (stored != null) {
      const ifUsed = defaultIfForSessionType(sessionType);
      return { tss: Math.round(stored), ifUsed, source: 'stored', warnings };
    }
  }

  const ifUsed = defaultIfForSessionType(sessionType);
  const tss = tssFromDurationAndIf(durationMin, ifUsed);
  return { tss, ifUsed, source: 'zone', warnings };
}

function sessionTssFromGoals(goals) {
  const manual = goalByType(goals, 'goal_tss');
  if (manual && manual.target_value != null) {
    const n = Number(manual.target_value);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

/**
 * Normalize goals for save: enforce duration, sync auto goal_tss.
 * @param {{ session_type: string, target_watts_label?: string }} day
 * @param {array} goals
 * @param {{ ftp?: number, manualOverride?: boolean }} options
 */
function applyProjectedTssGoals(day, goals, options = {}) {
  const sessionType = String(day?.session_type || 'rest').trim().toLowerCase();
  const ftp = Number(options.ftp);
  const safeFtp = Number.isFinite(ftp) && ftp > 0 ? ftp : DEFAULT_FTP;
  const list = (Array.isArray(goals) ? goals : []).map((g) => ({ ...g }));

  if (sessionType === 'rest') {
    return list.filter((g) => {
      const t = String(g.goal_type || '').toLowerCase();
      return t !== 'goal_duration_min' && t !== 'goal_if';
    });
  }

  const manualGoal = goalByType(list, 'goal_tss');
  if (options.manualOverride || isManualTssGoal(manualGoal)) {
    if (!manualGoal || manualGoal.target_value == null) {
      throw new Error('Manual TSS override requires goal_tss with a numeric target_value.');
    }
    return list;
  }

  const duration = goalValue(list, 'goal_duration_min');
  if (duration == null || duration <= 0) {
    if (options.enforceTss) {
      throw new Error('goal_duration_min is required for non-rest workouts.');
    }
    return list;
  }

  const estimate = estimateProjectedTss({
    sessionType,
    durationMin: duration,
    ftp: safeFtp,
    targetWattsLabel: day?.target_watts_label,
    goals: list
  });

  if (estimate.tss == null) {
    throw new Error('Could not compute projected TSS for this workout.');
  }

  const withoutAutoTss = list.filter((g) => String(g.goal_type || '').toLowerCase() !== 'goal_tss');
  withoutAutoTss.push({
    goal_type: 'goal_tss',
    target_value: estimate.tss,
    unit: 'TSS',
    notes: 'source:auto',
    sort_order: 99
  });
  return withoutAutoTss;
}

function buildGoalsFromWorkoutForm({
  sessionType,
  durationMin,
  label,
  watts,
  details,
  manualTss,
  manualOverride
}) {
  const goals = [];
  const st = String(sessionType || 'rest').toLowerCase();
  if (st === 'rest') return goals;

  if (durationMin != null && Number(durationMin) > 0) {
    goals.push({
      goal_type: 'goal_duration_min',
      target_value: Number(durationMin),
      unit: 'min',
      notes: null,
      sort_order: 0
    });
  }
  if (watts != null && Number(watts) > 0) {
    goals.push({
      goal_type: 'goal_wattage',
      target_value: Number(watts),
      unit: 'W',
      notes: null,
      sort_order: 1
    });
  }
  if (manualOverride && manualTss != null) {
    goals.push({
      goal_type: 'goal_tss',
      target_value: Number(manualTss),
      unit: 'TSS',
      notes: 'source:manual',
      sort_order: 99
    });
  }
  return goals;
}

const api = {
  DEFAULT_FTP,
  ZONE_IF,
  defaultIfForSessionType,
  estimateProjectedTss,
  sessionTssFromGoals,
  applyProjectedTssGoals,
  buildGoalsFromWorkoutForm,
  goalByType,
  goalValue,
  parseWatts,
  tssFromDurationAndIf
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== 'undefined') {
  globalThis.projectedTss = api;
}
