import assert from "node:assert/strict";
import { OrderLifecycle } from "@prisma/client";
import { isOrderOverdue, projectOrderStage } from "../lib/orders/presentation";

assert.equal(projectOrderStage(OrderLifecycle.CREATED), "measurement");
assert.equal(projectOrderStage(OrderLifecycle.PREPARATION), "measurement");
assert.equal(projectOrderStage(OrderLifecycle.READY_FOR_PRODUCTION), "preparation");
assert.equal(projectOrderStage(OrderLifecycle.IN_PRODUCTION, "CUTTING"), "preparation");
assert.equal(projectOrderStage(OrderLifecycle.IN_PRODUCTION, "PAINTING"), "painting");
assert.equal(projectOrderStage(OrderLifecycle.READY_FOR_INSTALLATION), "ready");
assert.equal(projectOrderStage(OrderLifecycle.INSTALLATION), "installation");
assert.equal(projectOrderStage(OrderLifecycle.ACCEPTANCE), "installation");
assert.equal(projectOrderStage(OrderLifecycle.COMPLETED), "completed");
assert.equal(isOrderOverdue("2026-08-01", OrderLifecycle.IN_PRODUCTION, new Date("2026-08-08")), true);
assert.equal(isOrderOverdue("2026-08-01", OrderLifecycle.COMPLETED, new Date("2026-08-08")), false);
assert.equal(isOrderOverdue(null, OrderLifecycle.IN_PRODUCTION), false);

console.log("Orders lifecycle projection, stage filters and overdue calculation passed");
