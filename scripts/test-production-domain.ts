import assert from "node:assert/strict";
import { Role } from "@prisma/client";

import {
  allowedAssigneeRoles,
  canAccessProduction,
  canCreateProduction,
  canReassignProduction,
  canTransitionProduction,
} from "../lib/production/access-policy";

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

const productionCard = { masterUserId: 10, stage: "Заготовка" as const };
const installationCard = { masterUserId: 20, stage: "Монтаж" as const };
assert.equal(canCreateProduction(Role.DIRECTOR), true);
assert.equal(canCreateProduction(Role.PRODUCTION), false);
assert.equal(canReassignProduction(Role.DIRECTOR), true);
assert.equal(canReassignProduction(Role.INSTALLER), false);
assert.equal(canAccessProduction(Role.DIRECTOR, 999, productionCard), true);
assert.equal(canAccessProduction(Role.PRODUCTION, 10, productionCard), true);
assert.equal(canAccessProduction(Role.PRODUCTION, 11, productionCard), false);
assert.equal(canAccessProduction(Role.PRODUCTION, 20, installationCard), false);
assert.equal(canAccessProduction(Role.INSTALLER, 20, installationCard), true);
assert.equal(canTransitionProduction(Role.PRODUCTION, 10, productionCard, "Покраска"), true);
assert.equal(canTransitionProduction(Role.PRODUCTION, 10, { masterUserId: 10, stage: "Заказ готов" }, "Монтаж"), false);
assert.equal(canTransitionProduction(Role.INSTALLER, 20, installationCard, "Сдано"), true);
assert.deepEqual(allowedAssigneeRoles("Монтаж"), [Role.INSTALLER, Role.DIRECTOR]);
assert.deepEqual(allowedAssigneeRoles("Сдано"), [Role.INSTALLER, Role.DIRECTOR]);
assert.deepEqual(allowedAssigneeRoles("Покраска"), [Role.PRODUCTION, Role.DIRECTOR]);

console.log("production domain checks passed");
