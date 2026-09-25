import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OrderLifecycle } from "@prisma/client";

import { calculateStair } from "../lib/calculator/stair-calculation";
import { projectOrderStatus, USER_ORDER_STATUSES } from "../lib/orders/presentation";
import { orderDataGaps } from "../lib/orders/completeness";

assert.equal(USER_ORDER_STATUSES.length, 7);
assert.equal(projectOrderStatus(OrderLifecycle.CREATED), "BEFORE_WORKSHOP");
assert.equal(projectOrderStatus(OrderLifecycle.IN_PRODUCTION), "IN_WORK");
assert.equal(projectOrderStatus(OrderLifecycle.ACCEPTANCE), "INSTALLATION");
assert.deepEqual(
  orderDataGaps({
    managerUserId: null,
    partnerId: null,
    partnerPrice: 0,
    partnerAgreedAt: null,
    promisedAt: null,
    productionDeadline: null,
    installation: null,
    client: { phone: "", city: "" },
  }),
  [
    "Назначить ответственного менеджера",
    "Телефон клиента",
    "Город клиента",
    "Срок заказа",
    "Назначить цех",
    "Цена производства",
  ],
);

for (const [material, workshopRate, saleRate] of [
  ["Дуб ламель", 60_000, 85_000],
  ["Карагач", 55_000, 80_000],
  ["Сосна", 45_000, 65_000],
] as const) {
  const result = calculateStair({
    material,
    regularSteps: 18,
    platformEquivalents: [2, 3],
  });
  assert.equal(result.equivalentSteps, 23);
  assert.equal(result.workshopCost, 23 * workshopRate);
  assert.equal(result.clientPrice, 23 * saleRate);
}

const rootLayout = readFileSync("app/layout.tsx", "utf8");
const routeShell = readFileSync("components/layout/RouteShell.tsx", "utf8");
const workspace = readFileSync("components/orders/OrderWorkspace.tsx", "utf8");
const economy = readFileSync("components/orders/OrderEconomy.tsx", "utf8");
const orderPageAuth = readFileSync("lib/order-page-auth.ts", "utf8");
const ordersApi = readFileSync("app/api/orders/route.ts", "utf8");
const newOrderForm = readFileSync("components/orders/NewOrderForm.tsx", "utf8");
const ordersPage = readFileSync("components/pages/OrdersPage.tsx", "utf8");
const workshopSettlement = readFileSync("components/orders/WorkshopSettlementPanel.tsx", "utf8");

assert.match(rootLayout, /RouteShell/);
assert.match(routeShell, /role === "DIRECTOR"[\s\S]*\["\/", "\/orders", "\/payroll", "\/reports"\]/);
for (const section of ["technical", "documents", "history", "files"])
  assert.match(workspace, new RegExp(`id="${section}"`));
for (const label of ["Исполнение", "Добавить оплату", "Редактировать", "Подробнее"])
  assert.match(workspace, new RegExp(label));
for (const removed of ["ORDER_STAGE_LABELS", "projectOrderStage", "Внутренние технические этапы"])
  assert.doesNotMatch(workspace, new RegExp(removed));
for (const label of ["Сумма продажи", "Подрядчик / производство", "Материалы", "Доставка", "Общая себестоимость", "Чистая прибыль", "Чистая маржа"])
  assert.match(economy, new RegExp(label));
assert.match(orderPageAuth, /Server Components serialize their props/);
assert.match(orderPageAuth, /partnerPrice: undefined/);
assert.match(orderPageAuth, /productionPrice/);
assert.doesNotMatch(
  orderPageAuth.slice(orderPageAuth.indexOf("lines: calculation.lines.map")),
  /unitCost: line\.unitCost/,
);
for (const label of ["Клиент", "Телефон", "Город / адрес", "Ответственный", "Цена клиенту", "Полученная оплата", "Срок", "Комментарий"])
  assert.match(newOrderForm, new RegExp(label));
assert.match(newOrderForm, /router\.push\(`\/orders\/\$\{body\.id\}`\)/);
assert.match(newOrderForm, /existingClient\?\.id/);
for (const tab of ["Заявки", "Активные", "Завершённые"])
  assert.match(ordersPage, new RegExp(tab));
for (const label of ["Цена производства", "Расчёт с цехом", "Поддержка цеху", "Аванс цеху", "Финальный расчёт"])
  assert.match(workshopSettlement, new RegExp(label));
for (const removed of ["Основание / комментарий", "Дата фиксации", "Поле обязательно до передачи заказа"])
  assert.doesNotMatch(workshopSettlement, new RegExp(removed));
assert.doesNotMatch(readFileSync("lib/services/order360.service.ts", "utf8"), /code: "PRODUCTION_PRICE"/);
assert.match(ordersPage, /missing-production-price/);
assert.match(ordersApi, /role !== Role\.DIRECTOR && role !== Role\.MANAGER/);
for (const field of ["partnerId", "partnerPrice", "partnerPaid", "companyProfit"])
  assert.match(ordersApi, new RegExp(`"${field}"`));
for (const page of ["offer", "contract", "act", "invoice", "print"])
  assert.ok(readFileSync(`app/orders/[id]/${page}/page.tsx`, "utf8").length > 0);

console.log("compact order workspace, unified statuses, security boundary and calculation checks passed");
