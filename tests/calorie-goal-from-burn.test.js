'use strict';

const assert = require('assert');
const { effectiveCalorieGoal, scaleMacrosFromKcal } = require('../lib/calorieGoalFromBurn.js');

function run() {
  const ex = effectiveCalorieGoal({ tagKcal: 2750, restKcal: 2300, burnt: 459 });
  assert.strictEqual(ex.builtinBump, 450);
  assert.strictEqual(ex.extraBurn, 9);
  assert.strictEqual(ex.effectiveKcal, 2759);

  const noBurn = effectiveCalorieGoal({ tagKcal: 2750, restKcal: 2300, burnt: null });
  assert.strictEqual(noBurn.extraBurn, 0);
  assert.strictEqual(noBurn.effectiveKcal, 2750);

  const burnBelowBump = effectiveCalorieGoal({ tagKcal: 2750, restKcal: 2300, burnt: 400 });
  assert.strictEqual(burnBelowBump.extraBurn, 0);
  assert.strictEqual(burnBelowBump.effectiveKcal, 2750);

  const restDay = effectiveCalorieGoal({ tagKcal: 2300, restKcal: 2300, burnt: 600 });
  assert.strictEqual(restDay.builtinBump, 0);
  assert.strictEqual(restDay.extraBurn, 600);
  assert.strictEqual(restDay.effectiveKcal, 2900);

  const scaled = scaleMacrosFromKcal({
    tagGoals: { kcal: 2750, carbs: 400, protein: 120, fat: 80 },
    effectiveKcal: 2759
  });
  assert.strictEqual(scaled.carbs, 401);
  assert.strictEqual(scaled.protein, 120);
  assert.strictEqual(scaled.fat, 80);

  console.log('calorie-goal-from-burn tests: PASS');
}

run();
