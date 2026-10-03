import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20261002183000_actual_order_date_control/migration.sql");
const ordersApi = read("app/api/orders/route.ts");
const orderApi = read("app/api/orders/[id]/route.ts");
const orderService = read("lib/services/order.service.ts");
const workspace = read("components/orders/OrderWorkspace.tsx");
const orderTable = read("components/orders/OrderTable.tsx");
const salesPlan = read("lib/services/sales-plan.service.ts");
const dashboard = read("lib/services/dashboard.service.ts");
const report = read("lib/services/report.service.ts");
const payroll = read("lib/services/payroll.service.ts");
const dailyOperations = read("lib/services/daily-operations.service.ts");
const order360 = read("lib/services/order360.service.ts");

assert.match(schema, /orderDateNeedsReview\s+Boolean\s+@default\(false\)/);
assert.match(migration, /SET "orderDateNeedsReview" = true/);
assert.equal(
  (migration.match(/ORD-20261001-[A-Z0-9]+/g) ?? []).length,
  9,
  "the migration must quarantine exactly the nine October-entered September orders",
);

assert.match(ordersApi, /orderDateNeedsReview: body\.orderReceivedAt === undefined/);
assert.match(ordersApi, /attention === "order-date"/);
assert.match(ordersApi, /attention === "incomplete"/);
assert.match(orderApi, /data\.orderDateNeedsReview = false/);
assert.match(orderApi, /Фактическая дата заказа подтверждена/);
assert.match(ordersApi, /todayAtAlmaty/);
assert.match(orderApi, /todayAtAlmaty/);
for (const source of [orderApi, orderService]) {
  assert.doesNotMatch(source, /managerUser:\s*\{\s*include:/, "order payload must not serialize the complete user record");
  assert.match(source, /managerUser:\s*\{\s*select:/, "order payload must explicitly select safe employee fields");
}
assert.match(workspace, /Нужно подтвердить/);
assert.match(workspace, /не входит в продажи месяца и расчёт бонуса менеджера/);
assert.match(orderTable, /orderDateNeedsReview/);

for (const source of [salesPlan, dashboard, report, payroll])
  assert.match(
    source,
    /orderDateNeedsReview: false|!order\.orderDateNeedsReview/,
    "monthly business calculations must exclude unconfirmed order dates",
  );

assert.match(dailyOperations, /Дата, когда карточку внесли в ORDA, датой продажи не считается/);
assert.match(dailyOperations, /расчётный лист и окончательная выплата зарплаты не формируются/);
assert.match(dailyOperations, /срок: \$\{deadline/);
assert.match(order360, /code: "ORDER_DATE"[\s\S]*Фактическая дата заказа не подтверждена/);
assert.match(order360, /\["ORDER_DATE", "WORKSHOP", "PRODUCTION_PRICE", "DEADLINE"\]/);

for (const forbidden of ["Дата внесения", "Создано в ORDA", "Техническая дата"])
  assert.doesNotMatch(`${workspace}\n${orderTable}`, new RegExp(forbidden, "i"));

console.log("actual order date controls: ok");
