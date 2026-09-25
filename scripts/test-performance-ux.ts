import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orders = readFileSync("components/pages/OrdersPage.tsx", "utf8");
assert.match(orders, /useDeferredValue/);
assert.match(orders, /OrderTable/);
assert.match(orders, /USER_ORDER_STATUSES/);
assert.match(orders, /compact/);

const documents = readFileSync("components/pages/DocumentsPage.tsx", "utf8");
assert.match(documents, /useDeferredValue/);

const orderService = readFileSync("lib/services/order.service.ts", "utf8");
const listStart = orderService.indexOf("export async function getOrders");
const listEnd = orderService.indexOf("export type OrderSearchActor", listStart);
const listQuery = orderService.slice(listStart, listEnd);
assert.doesNotMatch(listQuery, /documents:|productions:|blockers:|events:/);
assert.match(listQuery, /select:/);

const partners = readFileSync("components/pages/PartnersPage.tsx", "utf8");
assert.equal((partners.match(/fetch\("\/api\/partners\?view=all"\)/g) ?? []).length, 1);

const partnerDashboard = readFileSync(
  "app/api/partner/dashboard/route.ts",
  "utf8",
);
assert.match(partnerDashboard, /prisma\.payment\.findMany/);
assert.match(partnerDashboard, /take:\s*5/);
assert.doesNotMatch(partnerDashboard, /payments:\s*\{/);

const partnerProfile = readFileSync("app/api/partner/profile/route.ts", "utf8");
assert.doesNotMatch(
  `${partnerDashboard}\n${partnerProfile}`,
  /Partner access only|Partner profile not found|Name is required/,
);
console.log("performance UX checks passed");
