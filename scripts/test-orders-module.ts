import assert from "node:assert/strict";
import { OrderLifecycle } from "@prisma/client";
import { isOrderOverdue, projectOrderStage } from "../lib/orders/presentation";
import { readFileSync } from "node:fs";

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

const ordersPage = readFileSync("components/pages/OrdersPage.tsx", "utf8");
for (const filter of ["without-partner", "without-partner-price", "partner-payable", "overdue-client", "overdue-partner"])
  assert(ordersPage.includes(filter), `Order settlement filter is missing: ${filter}`);
for (const field of ["Сумма заказа", "Получено", "Остаток клиента", "Назначить цех"])
  assert(ordersPage.includes(field), `Orders-without-workshop list is missing ${field}`);

const settlementPanel = readFileSync("components/orders/OrderSettlementPanel.tsx", "utf8");
for (const block of ["Клиент", "Цех / партнёр", "Менеджер", "Замерщик"])
  assert(settlementPanel.includes(block), `Order financial waterfall is missing ${block}`);
for (const operation of ["Указать стоимость цеха", "Выплатить цеху", "Начислить бонус менеджеру"])
  assert(settlementPanel.includes(operation), `Order settlement operation is missing ${operation}`);

console.log("Orders lifecycle projection, stage filters and overdue calculation passed");
