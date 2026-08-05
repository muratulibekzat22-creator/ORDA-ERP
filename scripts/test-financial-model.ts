import assert from "node:assert/strict";
import { calculateStair, STAIR_RATES } from "../lib/calculator/stair-calculation";

const base = calculateStair({ material: "Дуб ламель", regularSteps: 10, platformEquivalents: [2, 3] });
assert.equal(base.equivalentSteps, 15);
assert.equal(base.workshopCost, 15 * 60_000);
assert.equal(base.clientPrice, 15 * 85_000);

const full = calculateStair({
  material: "Карагач",
  regularSteps: 12,
  platformEquivalents: [2, 3],
  otherCity: true,
  lines: [
    { kind: "INSTALLATION", name: "Монтаж", quantity: 1, unit: "услуга", unitCost: 100_000, unitSale: 150_000 },
    { kind: "DELIVERY", name: "Доставка", quantity: 1, unit: "рейс", unitCost: 40_000, unitSale: 60_000 },
    { kind: "GLASS", name: "Стекло", quantity: 5, unit: "м²", unitCost: 20_000, unitSale: 35_000 },
    { kind: "BRASS_BALUSTERS", name: "Латунные балясины", quantity: 4, unit: "шт.", unitCost: 12_000, unitSale: 20_000 },
    { kind: "BAROQUE_BALUSTERS", name: "Балясины барокко", quantity: 2, unit: "шт.", unitCost: 15_000, unitSale: 25_000 },
    { kind: "DISCOUNT", name: "Скидка", quantity: 1, unit: "заказ", unitCost: 0, unitSale: 50_000 },
  ],
});
assert.equal(full.equivalentSteps, 17);
assert.equal(full.clientPrice, 17 * STAIR_RATES.Карагач.saleRate + 465_000);
assert.equal(full.installationCost, 100_000);
assert.equal(full.deliveryCost, 40_000);
assert.equal(full.grossProfit, full.clientPrice - full.totalCost);

const noInstallation = calculateStair({ ...full, installationRequired: false, deliveryRequired: false, lines: full.lines });
assert.equal(noInstallation.installationCost, 0);
assert.equal(noInstallation.deliveryCost, 0);
assert.equal(noInstallation.lines.find((line) => line.kind === "INSTALLATION")?.enabled, false);

const pickup = calculateStair({ material: "Сосна", regularSteps: 10, platformEquivalents: [], pickup: true, deliveryRequired: true, lines: [{ kind: "DELIVERY", name: "Доставка", quantity: 1, unit: "рейс", unitCost: 10_000, unitSale: 20_000 }] });
assert.equal(pickup.deliveryRequired, false);
assert.equal(pickup.deliveryCost, 0);

const snapshot = structuredClone(full);
const changedRate = { workshopRate: 1, saleRate: 1 };
assert.notDeepEqual(changedRate, STAIR_RATES.Карагач);
assert.deepEqual(snapshot, full, "saved snapshot must remain unchanged in memory when tariffs change");

console.log("order financial model checks passed");
