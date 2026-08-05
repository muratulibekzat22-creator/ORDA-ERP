import assert from "node:assert/strict";

import {
  COMPLETED_PRODUCTION_STAGE,
  INITIAL_PRODUCTION_STAGE,
  PRODUCTION_STAGES,
  assertProductionStage,
  canTransitionProductionStage,
  getNextProductionStage,
  isCompletedProductionStage,
  isProductionStage,
} from "../lib/production/stage-policy";

assert.equal(INITIAL_PRODUCTION_STAGE, "Новая заявка");
assert.equal(COMPLETED_PRODUCTION_STAGE, "Сдано");
assert.equal(new Set(PRODUCTION_STAGES).size, PRODUCTION_STAGES.length);

for (const [index, stage] of PRODUCTION_STAGES.entries()) {
  assert.equal(isProductionStage(stage), true);
  assert.doesNotThrow(() => assertProductionStage(stage));

  const next = PRODUCTION_STAGES[index + 1] ?? null;
  assert.equal(getNextProductionStage(stage), next);
  assert.equal(isCompletedProductionStage(stage), stage === COMPLETED_PRODUCTION_STAGE);

  for (const candidate of PRODUCTION_STAGES) {
    assert.equal(canTransitionProductionStage(stage, candidate), candidate === next);
  }
}

assert.equal(isProductionStage(""), false);
assert.equal(isProductionStage("Готово"), false);
assert.equal(isProductionStage(null), false);
assert.throws(() => assertProductionStage("Готово"), /INVALID_PRODUCTION_STAGE/);

console.log("production domain checks passed");
