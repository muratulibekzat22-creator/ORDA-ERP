import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LeadStage } from "@prisma/client";

import {
  calculationProgress,
  hasRequiredProposalMaterials,
  proposalProgress,
  REQUIRED_PROPOSAL_MATERIALS,
} from "@/lib/leads/automatic-stage";

assert.equal(hasRequiredProposalMaterials(["Сосна", "Карагач"]), false);
assert.equal(hasRequiredProposalMaterials(REQUIRED_PROPOSAL_MATERIALS), true);

assert.deepEqual(calculationProgress(LeadStage.NEW, "NEW", false), {
  stage: LeadStage.NEW,
  status: "Нужен расчёт",
});
assert.deepEqual(calculationProgress(LeadStage.QUALIFIED, "QUALIFIED", true), {
  stage: LeadStage.CALCULATION_READY,
  status: "Расчёт готов",
});
assert.deepEqual(proposalProgress(LeadStage.NEW, "NEW"), {
  stage: LeadStage.CALCULATION_READY,
  status: "КП подготовлено",
});

for (const stage of [
  LeadStage.PROPOSAL_SENT,
  LeadStage.FOLLOW_UP,
  LeadStage.MEASUREMENT_SCHEDULED,
  LeadStage.MEASUREMENT_COMPLETED,
  LeadStage.NEGOTIATION,
  LeadStage.WON,
  LeadStage.LOST,
]) {
  const status = `status-${stage}`;
  assert.deepEqual(calculationProgress(stage, status, true), { stage, status });
  assert.deepEqual(proposalProgress(stage, status), { stage, status });
}

const calculationRoute = readFileSync(
  "app/api/clients/[id]/calculations/route.ts",
  "utf8",
);
const proposalRoute = readFileSync(
  "app/api/clients/[id]/proposals/route.ts",
  "utf8",
);
const clientsRoute = readFileSync("app/api/clients/route.ts", "utf8");
const analyticsService = readFileSync("lib/services/analytics.service.ts", "utf8");

assert.match(calculationRoute, /prisma\.\$transaction\(async \(tx\)/);
assert.match(calculationRoute, /delete result\.internalCost/);
assert.match(calculationRoute, /role === Role\.MANAGER/);
assert.match(calculationRoute, /fromStage: current\.stage/);
assert.match(proposalRoute, /proposalProgress\(currentClient\.stage/);
assert.match(proposalRoute, /fromStage: currentClient\.stage/);
assert.match(clientsRoute, /stage: status as LeadStage/);
assert.match(analyticsService, /countStage\(LeadStage\.CALCULATION_READY\)/);

console.log(
  "Lead calculations and three-option proposals advance the funnel without regressing later stages",
);
