import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";
import { calculateStair } from "../lib/calculator/stair-calculation";
import {
  canTransitionOrderStatus,
  normalizeOrderStatus,
  ORDER_STATUSES,
} from "../lib/orders/lifecycle";

assert.equal(ORDER_STATUSES.length, 12);
assert.equal(normalizeOrderStatus("Монтаж"), "Установка");
assert.equal(
  canTransitionOrderStatus(
    Role.MANAGER,
    "Новая заявка",
    "Коммерческое предложение отправлено",
  ),
  true,
);
assert.equal(
  canTransitionOrderStatus(Role.MANAGER, "Новая заявка", "Договор подписан"),
  false,
);
assert.equal(
  canTransitionOrderStatus(Role.PARTNER, "Заготовка", "Покраска"),
  true,
);
assert.equal(
  canTransitionOrderStatus(Role.PARTNER, "Заготовка", "Заказ завершён"),
  false,
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
  assert.equal(result.grossDifference, 23 * (saleRate - workshopRate));
}
const adjusted = calculateStair({
  material: "Карагач",
  regularSteps: 18,
  platformEquivalents: [2, 3],
  clientPrice: 2_000_000,
  workshopCost: 1_300_000,
});
assert.equal(adjusted.clientAdjustment, 160_000);
assert.equal(adjusted.workshopAdjustment, 35_000);
assert.throws(() =>
  calculateStair({
    material: "Сосна",
    regularSteps: -1,
    platformEquivalents: [],
  }),
);
assert.throws(() =>
  calculateStair({
    material: "Сосна",
    regularSteps: 10,
    platformEquivalents: [4],
  }),
);

const rootLayout = readFileSync("app/layout.tsx", "utf8");
const routeShell = readFileSync("components/layout/RouteShell.tsx", "utf8");
const workspace = readFileSync("components/orders/OrderWorkspace.tsx", "utf8");
const orderPageAuth = readFileSync("lib/order-page-auth.ts", "utf8");
const orderApi = readFileSync("app/api/orders/[id]/route.ts", "utf8");
const ordersApi = readFileSync("app/api/orders/route.ts", "utf8");
const newOrderForm = readFileSync("components/orders/NewOrderForm.tsx", "utf8");
const orderOptions = readFileSync("app/api/orders/options/route.ts", "utf8");
assert.match(rootLayout, /RouteShell/);
assert.match(routeShell, /pathname\.startsWith\(href\)/);
for (const section of [
  "client",
  "technical",
  "order-finance",
  "calculation",
  "documents",
  "history",
  "calendar",
  "production",
  "workshop",
  "files",
])
  assert.match(workspace, new RegExp(`id="${section}"`));
for (const action of [
  "Редактировать",
  "Печать",
  "Добавить файл",
  "Добавить комментарий",
  "Добавить оплату",
])
  assert.match(workspace, new RegExp(action));
assert.doesNotMatch(workspace, /Отправить КП|Отправить договор|Клиентский статус/);
assert.match(workspace, /OrderProcess/);
assert.match(workspace, /Внутренние технические этапы/);
assert.match(orderPageAuth, /Server Components serialize their props/);
assert.match(orderPageAuth, /partnerPrice: undefined/);
assert.match(orderPageAuth, /unitSale: line\.unitSale/);
assert.doesNotMatch(
  orderPageAuth.slice(orderPageAuth.indexOf("lines: calculation.lines.map")),
  /unitCost: line\.unitCost/,
);
assert.match(orderApi, /order-comment:/);
assert.match(orderApi, /Добавлен комментарий/);
for (const block of ["Клиент", "Заказ", "Технические параметры", "Финансы заказа", "Дополнительно"])
  assert.match(newOrderForm, new RegExp(`title="${block}"`));
assert.match(newOrderForm, /router\.push\(`\/orders\/\$\{body\.id\}`\)/);
assert.match(newOrderForm, /existingClient\?\.id/);
assert.match(ordersApi, /role !== Role\.DIRECTOR && role !== Role\.MANAGER/);
assert.match(ordersApi, /enforceClientOwnership: enhanced/);
assert.match(ordersApi, /Полученная сумма не может превышать сумму заказа/);
assert.match(orderOptions, /active: true, role: Role\.MANAGER/);
assert.match(orderOptions, /kind: "STAIR_MATERIAL"/);
for (const page of ["offer", "contract", "act", "invoice", "print"])
  assert.ok(
    readFileSync(`app/orders/[id]/${page}/page.tsx`, "utf8").length > 0,
  );
const printCss = readFileSync("app/globals.css", "utf8");
assert.match(printCss, /size: A4/);
assert.match(
  readFileSync("components/documents/CommercialProposal.tsx", "utf8"),
  /DocumentBrandHeader/,
);
console.log(
  "order workspace, lifecycle, security boundary and document checks passed",
);
