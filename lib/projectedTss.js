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

/**
 * Parse watt strings into min/max/point. Supports ranges, comparisons, prefixes.
 * @returns {{ min: number|null, max: number|null, point: number|null }}
 */
function parseWattsRange(value) {
  const empty = { min: null, max: null, point: null };
  if (value == null || value === '') return empty;

  const n = Number(value);
  if (Number.isFinite(n) && n > 0) {
    return { min: null, max: null, point: n };
  }

  const s = String(value).trim();
  const rangeMatch = s.match(/(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && a > 0 && b > 0) {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      return { min, max, point: (min + max) / 2 };
    }
  }

  const ltMatch = s.match(/<\s*(\d+(?:\.\d+)?)/);
  if (ltMatch) {
    const max = Number(ltMatch[1]);
    if (Number.isFinite(max) && max > 0) return { min: null, max, point: max };
  }

  const gtMatch = s.match(/>\s*(\d+(?:\.\d+)?)/);
  if (gtMatch) {
    const min = Number(gtMatch[1]);
    if (Number.isFinite(min) && min > 0) return { min, max: null, point: min };
  }

  const single = s.match(/(\d+(?:\.\d+)?)/);
  if (single) {
    const point = Number(single[1]);
    if (Number.isFinite(point) && point > 0) return { min: null, max: null, point };
  }

  return empty;
}

/** @deprecated Use parseWattsRange; returns first point watts for backward compatibility. */
function parseWatts(value) {
  const { point } = parseWattsRange(value);
  return point;
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
 * Resolve watts for TSS: explicit params > goal_wattage > min/max goals > label range.
 */
function resolveWattsForTss(params) {
  const goals = params?.goals;
  let wattsMin = params?.wattsMin;
  let wattsMax = params?.wattsMax;

  if (wattsMin == null && goals) wattsMin = goalValue(goals, 'goal_wattage_min');
  if (wattsMax == null && goals) wattsMax = goalValue(goals, 'goal_wattage_max');

  let watts = params?.watts;
  if (watts == null && goals) watts = goalValue(goals, 'goal_wattage');

  if (wattsMin != null && wattsMax != null) {
    const min = Number(wattsMin);
    const max = Number(wattsMax);
    if (Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0) {
      const lo = Math.min(min, max);
      const hi = Math.max(min, max);
      return { wattsUsed: (lo + hi) / 2, wattsMin: lo, wattsMax: hi };
    }
  }

  if (watts != null && Number(watts) > 0) {
    const w = Number(watts);
    return { wattsUsed: w, wattsMin: null, wattsMax: null };
  }

  if (wattsMin != null && Number(wattsMin) > 0) {
    const w = Number(wattsMin);
    return { wattsUsed: w, wattsMin: w, wattsMax: null };
  }
  if (wattsMax != null && Number(wattsMax) > 0) {
    const w = Number(wattsMax);
    return { wattsUsed: w, wattsMin: null, wattsMax: w };
  }

  const fromLabel = parseWattsRange(params?.targetWattsLabel);
  if (fromLabel.point != null) {
    return {
      wattsUsed: fromLabel.point,
      wattsMin: fromLabel.min,
      wattsMax: fromLabel.max
    };
  }

  return { wattsUsed: null, wattsMin: null, wattsMax: null };
}

/**
 * @param {{
 *   sessionType?: string,
 *   durationMin?: number|null,
 *   ftp?: number,
 *   watts?: number|null,
 *   wattsMin?: number|null,
 *   wattsMax?: number|null,
 *   targetWattsLabel?: string|null,
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
      wattsUsed: null,
      wattsMin: null,
      wattsMax: null,
      warnings
    };
  }

  if (sessionType === 'rest') {
    return {
      tss: 0,
      ifUsed: 0,
      source: 'zone',
      wattsUsed: null,
      wattsMin: null,
      wattsMax: null,
      warnings
    };
  }

  let durationMin = params?.durationMin;
  if (durationMin == null && goals) durationMin = goalValue(goals, 'goal_duration_min');
  if (durationMin == null || !Number.isFinite(Number(durationMin)) || Number(durationMin) <= 0) {
    return {
      tss: null,
      ifUsed: null,
      source: null,
      wattsUsed: null,
      wattsMin: null,
      wattsMax: null,
      warnings: ['duration required']
    };
  }
  durationMin = Number(durationMin);

  const resolved = resolveWattsForTss({
    watts: params?.watts,
    wattsMin: params?.wattsMin,
    wattsMax: params?.wattsMax,
    targetWattsLabel: params?.targetWattsLabel,
    goals
  });

  if (resolved.wattsUsed != null) {
    const ifUsed = clampIf(resolved.wattsUsed / safeFtp);
    const tss = tssFromDurationAndIf(durationMin, ifUsed);
    return {
      tss,
      ifUsed,
      source: 'watts',
      wattsUsed: resolved.wattsUsed,
      wattsMin: resolved.wattsMin,
      wattsMax: resolved.wattsMax,
      warnings
    };
  }

  let explicitIf = params?.explicitIf;
  if (explicitIf == null && goals) explicitIf = goalValue(goals, 'goal_if');
  if (explicitIf != null) {
    const ifUsed = clampIf(explicitIf);
    const tss = tssFromDurationAndIf(durationMin, ifUsed);
    return {
      tss,
      ifUsed,
      source: 'if',
      wattsUsed: null,
      wattsMin: null,
      wattsMax: null,
      warnings
    };
  }

  const autoGoal = goalByType(goals, 'goal_tss');
  if (autoGoal && !isManualTssGoal(autoGoal)) {
    const stored = goalValue(goals, 'goal_tss');
    if (stored != null) {
      const ifUsed = defaultIfForSessionType(sessionType);
      return {
        tss: Math.round(stored),
        ifUsed,
        source: 'stored',
        wattsUsed: null,
        wattsMin: null,
        wattsMax: null,
        warnings
      };
    }
  }

  const ifUsed = defaultIfForSessionType(sessionType);
  const tss = tssFromDurationAndIf(durationMin, ifUsed);
  return {
    tss,
    ifUsed,
    source: 'zone',
    wattsUsed: null,
    wattsMin: null,
    wattsMax: null,
    warnings
  };
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

function formatWattsLabel(watts, wattsMin, wattsMax) {
  if (wattsMin != null && wattsMax != null && Number(wattsMin) > 0 && Number(wattsMax) > 0) {
    const lo = Math.min(Number(wattsMin), Number(wattsMax));
    const hi = Math.max(Number(wattsMin), Number(wattsMax));
    return `${lo}–${hi}W`;
  }
  if (watts != null && Number(watts) > 0) return `${Number(watts)}W`;
  return null;
}

function buildGoalsFromWorkoutForm({
  sessionType,
  durationMin,
  label,
  watts,
  wattsMin,
  wattsMax,
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

  const wMin = wattsMin != null && Number(wattsMin) > 0 ? Number(wattsMin) : null;
  const wMax = wattsMax != null && Number(wattsMax) > 0 ? Number(wattsMax) : null;
  if (wMin != null && wMax != null) {
    goals.push({
      goal_type: 'goal_wattage_min',
      target_value: wMin,
      unit: 'W',
      notes: null,
      sort_order: 1
    });
    goals.push({
      goal_type: 'goal_wattage_max',
      target_value: wMax,
      unit: 'W',
      notes: null,
      sort_order: 2
    });
  } else if (watts != null && Number(watts) > 0) {
    goals.push({
      goal_type: 'goal_wattage',
      target_value: Number(watts),
      unit: 'W',
      notes: null,
      sort_order: 1
    });
  } else if (wMin != null) {
    goals.push({
      goal_type: 'goal_wattage_min',
      target_value: wMin,
      unit: 'W',
      notes: null,
      sort_order: 1
    });
  } else if (wMax != null) {
    goals.push({
      goal_type: 'goal_wattage_max',
      target_value: wMax,
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
  parseWattsRange,
  resolveWattsForTss,
  formatWattsLabel,
  tssFromDurationAndIf
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== 'undefined') {
  globalThis.projectedTss = api;
}
