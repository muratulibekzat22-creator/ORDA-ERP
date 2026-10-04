import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OrderLifecycle } from "@prisma/client";

import { calculateStair } from "../lib/calculator/stair-calculation";
import { projectOrderStatus, USER_ORDER_STATUSES } from "../lib/orders/presentation";
import { orderDataGaps } from "../lib/orders/completeness";
import { ORDER_BOARD_TARGET_LIFECYCLE, orderBoardColumn } from "../lib/orders/board";
import { hasProductionPrice } from "../lib/orders/production-price";
import {
  companyMonthRange,
  companyYearMonth,
  isCompanyMonthComplete,
  isCompanyMonthStarted,
} from "../lib/company-calendar";

assert.equal(USER_ORDER_STATUSES.length, 7);
assert.equal(projectOrderStatus(OrderLifecycle.CREATED), "BEFORE_WORKSHOP");
assert.equal(projectOrderStatus(OrderLifecycle.IN_PRODUCTION), "IN_WORK");
assert.equal(projectOrderStatus(OrderLifecycle.ACCEPTANCE), "INSTALLATION");
assert.equal(orderBoardColumn(OrderLifecycle.CREATED), "ORDERED");
assert.equal(orderBoardColumn(OrderLifecycle.PREPARATION), "CONTRACT");
assert.equal(orderBoardColumn(OrderLifecycle.IN_PRODUCTION), "WORKSHOP");
assert.equal(orderBoardColumn(OrderLifecycle.COMPLETED), "COMPLETED");
assert.equal(orderBoardColumn(OrderLifecycle.CANCELLED), null);
assert.equal(ORDER_BOARD_TARGET_LIFECYCLE.CONTRACT, OrderLifecycle.PREPARATION);
assert.equal(ORDER_BOARD_TARGET_LIFECYCLE.WORKSHOP, OrderLifecycle.READY_FOR_PRODUCTION);
assert.equal(hasProductionPrice(1, new Date()), false, "legacy 1 ₸ placeholder entered profit calculations");
assert.equal(hasProductionPrice(111, new Date()), false, "legacy 111 ₸ placeholder entered profit calculations");
assert.equal(hasProductionPrice(10_000, new Date()), true);
assert.deepEqual(
  Object.fromEntries(
    Object.entries(companyMonthRange(2026, 9)).map(([key, value]) => [key, value.toISOString()]),
  ),
  {
    start: "2026-08-31T19:00:00.000Z",
    end: "2026-09-30T19:00:00.000Z",
  },
  "company month must use the Kazakhstan UTC+5 business boundary",
);
assert.deepEqual(
  companyYearMonth(new Date("2026-09-30T19:00:00.000Z")),
  { year: 2026, month: 10 },
);
assert.equal(
  isCompanyMonthComplete(2026, 9, new Date("2026-09-30T19:00:00.000Z")),
  true,
);
assert.equal(
  isCompanyMonthComplete(2026, 10, new Date("2026-10-02T07:00:00.000Z")),
  false,
);
assert.equal(
  isCompanyMonthStarted(2026, 11, new Date("2026-10-02T07:00:00.000Z")),
  false,
);
assert.deepEqual(
  orderDataGaps({
    responsibleType: "EMPLOYEE",
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
assert.equal(
  orderDataGaps({
    responsibleType: "COMPANY",
    managerUserId: null,
    partnerId: 1,
    partnerPrice: 500_000,
    partnerAgreedAt: new Date(),
    promisedAt: new Date(),
    client: { phone: "77000000000", city: "Караганда" },
  }).includes("Назначить ответственного менеджера"),
  false,
  "a COMPANY order must not be marked incomplete for lacking managerUserId",
);
assert.equal(
  orderDataGaps({
    responsibleType: "EMPLOYEE",
    managerUserId: 1,
    partnerId: 1,
    partnerPrice: 500_000,
    partnerAgreedAt: null,
    promisedAt: new Date(),
    client: { phone: "77000000000", city: "Караганда" },
  }).includes("Цена производства"),
  true,
  "a legacy amount without a confirmed production-price date must stay visible for repair",
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
const orderDetailApi = readFileSync("app/api/orders/[id]/route.ts", "utf8");
const newOrderForm = readFileSync("components/orders/NewOrderForm.tsx", "utf8");
const ordersPage = readFileSync("components/pages/OrdersPage.tsx", "utf8");
const workshopSettlement = readFileSync("components/orders/WorkshopSettlementPanel.tsx", "utf8");
const orderProcess = readFileSync("components/orders/OrderProcess.tsx", "utf8");
const orderKanban = readFileSync("components/orders/OrderKanban.tsx", "utf8");
const orderBoard = readFileSync("lib/orders/board.ts", "utf8");
const dashboardService = readFileSync("lib/services/dashboard.service.ts", "utf8");
const orderDeletionService = readFileSync("lib/services/order-deletion.service.ts", "utf8");
const reportService = readFileSync("lib/services/report.service.ts", "utf8");
const paymentsRoute = readFileSync("app/api/payments/route.ts", "utf8");
const paymentService = readFileSync("lib/services/payment.service.ts", "utf8");
const paymentReceiptService = readFileSync("lib/services/payment-receipt.service.ts", "utf8");

assert.match(rootLayout, /RouteShell/);
assert.match(routeShell, /const founder = accountRole === "DIRECTOR"/);
assert.match(routeShell, /accountRole === "OPERATIONS_DIRECTOR"/);
assert.match(routeShell, /grantedPermissions\.includes/);
assert.match(routeShell, /"\/marketing", "Маркетинг"/);
assert.match(routeShell, /role === "MANAGER"[\s\S]*"\/production"/);
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
for (const tab of ["Активные заказы", "Все заказы", "Завершённые заказы"])
  assert.match(ordersPage, new RegExp(tab));
for (const column of ["Заказ оформлен", "Договор", "Передан в цех", "Заказ завершён"])
  assert.match(`${orderKanban}\n${orderBoard}`, new RegExp(column));
for (const label of ["Продажа:", "Остаток клиента:", "Срок не указан"])
  assert.match(orderKanban, new RegExp(label));
assert.match(orderKanban, /draggable=/);
assert.match(orderKanban, /text\/order-id/);
assert.match(ordersPage, /available-transitions/);
assert.match(ordersPage, /action: "transition"/);
assert.match(workspace, /\["clientName", "Имя клиента"\]/);
assert.match(orderDetailApi, /tx\.client\.update\([\s\S]*name: clientName/);
assert.match(orderDetailApi, /!isDirector\(role\) && role !== Role\.MANAGER/);
assert.match(orderDetailApi, /action: "COMMERCIAL_ADJUSTMENT"/);
assert.match(orderDetailApi, /Изменение суммы продажи при редактировании заказа/);
assert.match(ordersApi, /"active", "board", "completed", "all"/);
for (const label of ["Цена производства", "Расчёт с цехом", "Поддержка цеху", "Аванс цеху", "Финальный расчёт"])
  assert.match(workshopSettlement, new RegExp(label));
assert.match(workshopSettlement, /canManageWorkshop/);
assert.match(workshopSettlement, /role === "MANAGER"/);
for (const label of ["Передать заказ в цех", "Выберите цех", "Цена производства, ₸", "Подтвердить и передать"])
  assert.match(orderProcess, new RegExp(label));
for (const label of ["Начать производство", "Готово к монтажу", "Начать монтаж", "Вернуть в «Договор»", "Причина"])
  assert.match(orderProcess, new RegExp(label));
assert.match(orderProcess, /action: "assignPartner"/);
assert.match(orderProcess, /action: "transition"/);
for (const removed of ["Основание / комментарий", "Дата фиксации", "Поле обязательно до передачи заказа"])
  assert.doesNotMatch(workshopSettlement, new RegExp(removed));
const order360 = readFileSync("lib/services/order360.service.ts", "utf8");
assert.match(order360, /code: "SALE_AMOUNT"[\s\S]*code: "PRODUCTION_PRICE"/);
assert.match(order360, /code: "PRODUCTION_PRICE"[\s\S]*Не указана сумма производства/);
assert.match(order360, /target === OrderLifecycle\.PREPARATION[\s\S]*PARTNER_REQUIRED[\s\S]*PARTNER_COST_REQUIRED/);
assert.match(order360, /WORKSHOP_ASSIGNMENT_CLEARED/);
assert.match(order360, /ROLLBACK_BLOCKED/);
const order360Access = order360.slice(
  order360.indexOf("export async function canAccessOrder360"),
  order360.indexOf("async function assertAccess"),
);
assert.match(
  order360Access,
  /order\.responsibleType === OrderResponsibleType\.EMPLOYEE[\s\S]*order\.managerUserId === actor\.userId/,
  "Order360 manager access must use the current normalized responsibility",
);
assert.doesNotMatch(
  order360Access,
  /leadConversion|order\.manager === actor\.name/,
  "Order360 access must not load or trust historical lead ownership or display names",
);
assert.match(
  order360,
  /order\.responsibleType === OrderResponsibleType\.EMPLOYEE[\s\S]*\? order\.managerUserId[\s\S]*: null;[\s\S]*masterUserId: currentResponsibleUserId/,
  "company-owned orders must not assign workflow work to a stale employee",
);
assert.match(
  order360,
  /manager: order\.responsibleType === OrderResponsibleType\.COMPANY[\s\S]*\{ id: null, name: "Компания" \}/,
  "order overview must project the current company responsibility",
);
assert.match(ordersPage, /missing-production-price/);
assert.match(ordersApi, /!isDirector\(role\) && role !== Role\.MANAGER/);
assert.match(
  dashboardService,
  /responsibleType: OrderResponsibleType\.EMPLOYEE,[\s\S]*managerUserId: scope\.userId/,
  "manager dashboard must use the current normalized order responsibility",
);
assert.doesNotMatch(
  dashboardService.slice(dashboardService.indexOf("async function managerProjection")),
  /leadConversion:\s*\{\s*managerId:/,
  "manager dashboard still trusts historical lead ownership",
);
assert.match(
  orderDeletionService,
  /order\.responsibleType === OrderResponsibleType\.EMPLOYEE[\s\S]*order\.managerUserId === actor\.userId/,
  "manager deletion must use the current normalized order responsibility",
);
assert.doesNotMatch(
  orderDeletionService,
  /leadConversion|order\.manager === actor\.name/,
  "manager deletion still trusts historical lead ownership or a display name",
);
assert.match(
  reportService,
  /responsibleType: OrderResponsibleType\.EMPLOYEE,[\s\S]*managerUserId: scope\.managerUserId/,
  "manager report scope must use current normalized order responsibility",
);
assert.match(
  reportService,
  /item\.responsibleType === OrderResponsibleType\.EMPLOYEE && item\.managerUserId/,
  "company-owned orders must not increase manager report metrics",
);
assert.match(
  paymentsRoute,
  /role === Role\.MANAGER \? \{ responsibleType: OrderResponsibleType\.EMPLOYEE, managerUserId:/,
  "manager payment writes must require current employee responsibility",
);
assert.match(
  paymentService,
  /order: \{ responsibleType: OrderResponsibleType\.EMPLOYEE, managerUserId: filters\.managerUserId/,
  "manager payment reads must exclude company-owned orders",
);
assert.match(
  paymentReceiptService,
  /order\.responsibleType !== OrderResponsibleType\.EMPLOYEE/,
  "a stale employee id on a COMPANY order must not authorize a receipt",
);
for (const source of [dashboardService, reportService])
  assert.match(source, /hasProductionPrice\(.*partnerPrice, .*partnerAgreedAt\)/, "management calculation bypasses the production-price rule");
for (const field of ["partnerId", "partnerPrice", "partnerPaid", "companyProfit"])
  assert.match(ordersApi, new RegExp(`"${field}"`));
for (const page of ["offer", "contract", "act", "invoice", "print"])
  assert.ok(readFileSync(`app/orders/[id]/${page}/page.tsx`, "utf8").length > 0);

console.log("compact order workspace, unified statuses, security boundary and calculation checks passed");
