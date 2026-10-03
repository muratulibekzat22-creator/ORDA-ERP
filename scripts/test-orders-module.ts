import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OrderLifecycle } from "@prisma/client";
import { ACTIVE_ORDER_BOARD_COLUMNS, ORDER_BOARD_COLUMNS, ORDER_BOARD_TARGET_LIFECYCLE, orderBoardColumn } from "../lib/orders/board";

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
assert.deepEqual(ACTIVE_ORDER_BOARD_COLUMNS.map(c => c.key), ["ORDERED", "CONTRACT", "WORKSHOP"]);
assert.equal(ORDER_BOARD_COLUMNS.length, 4);
assert.equal(ORDER_BOARD_TARGET_LIFECYCLE.COMPLETED, OrderLifecycle.COMPLETED);
const orderKanban = readFileSync("components/orders/OrderKanban.tsx", "utf8");
assert(orderKanban.includes('column.key === "COMPLETED" ? []'));
assert(orderKanban.includes("Перетащите сюда, чтобы завершить заказ"));
assert(orderKanban.includes("ORDER_BOARD_COLUMNS.map((target)"), "mobile retains completion target");
for (const lifecycle of [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED]) {
  assert.equal(ACTIVE_ORDER_BOARD_COLUMNS.some(c => c.key === orderBoardColumn(lifecycle)), false);
}

const ordersPage = readFileSync("components/pages/OrdersPage.tsx", "utf8");
for (const tab of ["Активные заказы", "Все заказы", "Завершённые заказы"])
  assert(ordersPage.includes(tab), `Orders page is missing the ${tab} tab`);
for (const removed of ["without-partner", "partner-payable", "overdue-client"])
  assert(!ordersPage.includes(removed), `Legacy settlement filter remains: ${removed}`);
const ordersApi = readFileSync("app/api/orders/route.ts", "utf8");
assert.match(ordersApi, /tab === "completed"\s*\? \{ lifecycle: OrderLifecycle\.COMPLETED \}/, "completed tab must contain only completed orders");
assert.match(ordersApi, /tab === "active" \|\| tab === "board"\s*\? \{ lifecycle: \{ notIn: \[OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED\]/);
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
