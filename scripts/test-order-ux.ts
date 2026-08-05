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
assert.match(rootLayout, /RouteShell/);
assert.match(routeShell, /pathname\.startsWith\(href\)/);
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
  "order lifecycle, calculator, layout and A4 document checks passed",
);
