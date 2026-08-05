import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orders = readFileSync("components/pages/OrdersPage.tsx", "utf8");
assert.match(orders, /useDeferredValue/);
assert.match(orders, /dynamic\(\(\) => import\("@\/components\/orders\/OrderForm"\)/);
assert.match(orders, /visibleCount/);
assert.match(orders, /ORDER_STATUSES/);

const documents = readFileSync("components/pages/DocumentsPage.tsx", "utf8");
assert.match(documents, /useDeferredValue/);

const orderService = readFileSync("lib/services/order.service.ts", "utf8");
const listStart = orderService.indexOf("export async function getOrders");
const listEnd = orderService.indexOf("export async function getOrder(id", listStart);
const listQuery = orderService.slice(listStart, listEnd);
assert.doesNotMatch(listQuery, /payments: true|productions: true|events:/);
assert.match(listQuery, /select:/);

const partners = readFileSync("components/pages/PartnersPage.tsx", "utf8");
assert.equal((partners.match(/fetch\("\/api\/partners"\)/g) ?? []).length, 1);
console.log("performance UX checks passed");
