'use strict';

/**
 * @param {{ tagKcal: number, restKcal: number, burnt: unknown }} params
 * @returns {{ effectiveKcal: number, builtinBump: number, extraBurn: number }}
 */
function effectiveCalorieGoal({ tagKcal, restKcal, burnt }) {
  const tag = Number(tagKcal);
  const rest = Number(restKcal);
  const safeTag = Number.isFinite(tag) ? tag : 0;
  const safeRest = Number.isFinite(rest) ? rest : 0;
  const builtinBump = Math.max(0, safeTag - safeRest);

  const burntNum = burnt == null ? NaN : Number(burnt);
  const hasBurnt = Number.isFinite(burntNum) && burntNum >= 0;
  const extraBurn = hasBurnt ? Math.max(0, burntNum - builtinBump) : 0;
  const effectiveKcal = Math.round(safeTag + extraBurn);

  return { effectiveKcal, builtinBump, extraBurn };
}

/**
 * Scale macro gram targets when effective kcal differs from tag kcal.
 * @param {{ tagGoals: { kcal: number, carbs: number, protein: number, fat: number }, effectiveKcal: number }} params
 * @returns {{ carbs: number, protein: number, fat: number }}
 */
function scaleMacrosFromKcal({ tagGoals, effectiveKcal }) {
  const tk = Number(tagGoals?.kcal);
  const ec = Number(effectiveKcal);
  const carbs = Number(tagGoals?.carbs);
  const protein = Number(tagGoals?.protein);
  const fat = Number(tagGoals?.fat);

  if (!Number.isFinite(tk) || tk <= 0 || !Number.isFinite(ec)) {
    return {
      carbs: Number.isFinite(carbs) ? Math.round(carbs) : 0,
      protein: Number.isFinite(protein) ? Math.round(protein) : 0,
      fat: Number.isFinite(fat) ? Math.round(fat) : 0
    };
  }

  const scale = ec / tk;
  return {
    carbs: Math.round(carbs * scale),
    protein: Math.round(protein * scale),
    fat: Math.round(fat * scale)
  };
}

const api = { effectiveCalorieGoal, scaleMacrosFromKcal };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = api;
}
if (typeof globalThis !== 'undefined') {
  globalThis.calorieGoalFromBurn = api;
}
