import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OrderLifecycle } from "@prisma/client";

import {
  isOrderOverdue,
  projectOrderStatus,
  USER_ORDER_STATUSES,
} from "../lib/orders/presentation";

assert.deepEqual(USER_ORDER_STATUSES, [
  "BEFORE_WORKSHOP",
  "TRANSFERRED_TO_WORKSHOP",
  "IN_WORK",
  "READY_FOR_INSTALLATION",
  "INSTALLATION",
  "COMPLETED",
  "CANCELLED",
]);
assert.equal(projectOrderStatus(OrderLifecycle.CREATED), "BEFORE_WORKSHOP");
assert.equal(projectOrderStatus(OrderLifecycle.PREPARATION), "BEFORE_WORKSHOP");
assert.equal(
  projectOrderStatus(OrderLifecycle.READY_FOR_PRODUCTION),
  "TRANSFERRED_TO_WORKSHOP",
);
assert.equal(projectOrderStatus(OrderLifecycle.IN_PRODUCTION), "IN_WORK");
assert.equal(
  projectOrderStatus(OrderLifecycle.READY_FOR_INSTALLATION),
  "READY_FOR_INSTALLATION",
);
assert.equal(projectOrderStatus(OrderLifecycle.INSTALLATION), "INSTALLATION");
assert.equal(projectOrderStatus(OrderLifecycle.ACCEPTANCE), "INSTALLATION");
assert.equal(projectOrderStatus(OrderLifecycle.COMPLETED), "COMPLETED");
assert.equal(projectOrderStatus(OrderLifecycle.CANCELLED), "CANCELLED");
assert.equal(
  isOrderOverdue(
    "2026-08-01",
    OrderLifecycle.IN_PRODUCTION,
    new Date("2026-08-08"),
  ),
  true,
);
assert.equal(
  isOrderOverdue(
    "2026-08-01",
    OrderLifecycle.COMPLETED,
    new Date("2026-08-08"),
  ),
  false,
);
assert.equal(isOrderOverdue(null, OrderLifecycle.IN_PRODUCTION), false);

const ordersPage = readFileSync("components/pages/OrdersPage.tsx", "utf8");
for (const tab of ["Заявки", "Канбан", "Завершённые"])
  assert(ordersPage.includes(tab), `Orders page is missing the ${tab} tab`);
for (const removed of ["without-partner", "partner-payable", "overdue-client"])
  assert(!ordersPage.includes(removed), `Legacy settlement filter remains: ${removed}`);
const ordersApi = readFileSync("app/api/orders/route.ts", "utf8");
assert(ordersApi.includes("[OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED]"), "completed tab must retain cancelled orders");
assert(ordersApi.includes('mode: "insensitive"'), "legacy manager order fallback must ignore name casing");
const ownershipMigration = readFileSync(
  "prisma/migrations/20260925143000_normalize_manager_ownership/migration.sql",
  "utf8",
);
assert.match(ownershipMigration, /lower\(trim\(u\."name"\)\) = lower\(trim\(o\."manager"\)\)/);
assert.doesNotMatch(ownershipMigration, /\b(?:DELETE|TRUNCATE|DROP)\b/i);

const workspace = [
  readFileSync("components/orders/OrderWorkspace.tsx", "utf8"),
  readFileSync("components/orders/OrderEconomy.tsx", "utf8"),
].join("\n");
for (const block of ["Экономика заказа", "Исполнение", "Технические параметры", "Документы", "Файлы", "История"])
  assert(workspace.includes(block), `Order workspace is missing ${block}`);
for (const removed of ["ORDER_STAGE_LABELS", "projectOrderStage", "Текущий этап производства"])
  assert(!workspace.includes(removed), `Legacy production stage remains: ${removed}`);

console.log("Orders: seven-status projection, filters, deadlines and compact workspace PASS");
