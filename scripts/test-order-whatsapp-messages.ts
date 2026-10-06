import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildOrderWhatsAppMessages, paymentPromiseDayLabel } from "@/lib/orders/whatsapp-messages";

const now = new Date("2026-10-06T02:00:00.000Z");
const result = buildOrderWhatsAppMessages({
  clientName: "Мейіржан Асан Мырзаұлы",
  phone: "+7 778 338 32 32",
  mapUrl: "https://2gis.kz/almaty/example",
  address: "Нурлы таң 39",
  staircase: "Бетон",
  material: "Дубламель",
  railingType: "Тонированное стекло и шпон",
  supportType: "",
  lighting: true,
  lightingDetails: "",
  cladding: true,
  claddingDetails: "",
  additionalDetails: "СРОЧНЫЙ ЗАКАЗ — 30-на дейін біту керек",
  orderReceivedAt: "2026-10-02T00:00:00.000Z",
  promisedAt: "2026-10-30T00:00:00.000Z",
  manager: "Гулсим",
  amount: 3_900_000,
  received: 930_000,
  balance: 2_970_000,
  paymentMethod: "Перевод",
  paymentPromises: [{ amount: 1_800_000, dueAt: "2026-10-07T04:00:00.000Z" }],
}, now);

assert.equal(result.promisedTotal, 1_800_000);
assert.equal(result.plannedBalance, 1_170_000);
assert.match(result.orderText, /Остаток: 1\s170\s000 тг/);
assert.match(result.orderText, /Улица: https:\/\/2gis\.kz\/almaty\/example/);
assert.match(result.orderText, /Стойка: —/);
assert.match(result.financeText, /Полученная сумма: 930\s000 тг/);
assert.match(result.financeText, /\(Ертең 1\s800\s000 салады\)/);
assert.match(result.financeText, /ОСТАТОК: 1\s170\s000 тг/);
assert.equal(paymentPromiseDayLabel("2026-10-07T04:00:00.000Z", now), "Ертең");

const schema = readFileSync("prisma/schema.prisma", "utf8");
const migration = readFileSync("prisma/migrations/20261006072000_order_whatsapp_messages/migration.sql", "utf8");
const route = readFileSync("app/api/orders/route.ts", "utf8");
assert.match(schema, /messageTemplateVersion\s+Int\s+@default\(0\)/);
assert.match(migration, /DEFAULT 0/);
assert.match(route, /messageTemplateVersion/);

console.log("order WhatsApp message scenarios passed");
