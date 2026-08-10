import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { defaultPermissions } from "@/lib/permissions";
import { roleHome } from "@/lib/role-home";
import { Role } from "@/lib/roles";

const read = (path: string) => readFileSync(path, "utf8");
const includesAll = (source: string, values: string[], subject: string) => {
  for (const value of values)
    assert.ok(source.includes(value), `${subject} is missing ${value}`);
};

const expectedPermissions: Partial<Record<Role, string[]>> = {
  [Role.DIRECTOR]: [
    "employees",
    "clients",
    "orders",
    "measurements",
    "calendar",
    "documents",
    "finance",
    "partners",
    "reports",
    "settings",
    "design",
    "production",
    "installation",
    "warehouse",
    "payroll",
  ],
  [Role.MANAGER]: [
    "clients",
    "orders",
    "measurements",
    "calendar",
    "documents",
    "production",
    "warehouse",
    "partners",
  ],
  [Role.ACCOUNTANT]: [
    "documents",
    "finance",
    "partners",
    "reports",
    "warehouse",
    "payroll",
  ],
  [Role.MEASURER]: ["measurements", "calendar", "documents"],
  [Role.PRODUCTION]: ["production", "calendar", "documents", "warehouse"],
  [Role.INSTALLER]: [
    "production",
    "installation",
    "calendar",
    "documents",
    "warehouse",
  ],
  [Role.PARTNER]: ["orders", "finance", "partners", "documents"],
};

for (const [role, permissions] of Object.entries(expectedPermissions))
  assert.deepEqual(
    [...defaultPermissions[role as Role]].sort(),
    [...permissions].sort(),
    `${role} permission baseline changed`,
  );

assert.deepEqual(roleHome, {
  PARTNER: "/partner",
});

const roleDashboard = read("components/dashboard/Dashboard.tsx");
includesAll(
  roleDashboard,
  ["DIRECTOR", "MANAGER", "ACCOUNTANT", "PRODUCTION", "INSTALLER"],
  "role dashboards",
);

const proxy = read("proxy.ts");
includesAll(
  proxy,
  [
    'role === "PARTNER" && firstSegment === "finance"',
    'new URL("/partner", request.url)',
    'firstSegment === "calculator"',
    '? "orders"',
  ],
  "page proxy",
);

const sidebar = read("components/layout/Sidebar.tsx");
assert.match(sidebar, /role === "PARTNER" && id === "finance"/);
assert.doesNotMatch(sidebar, /title: "Dashboard"|>\s*ONLINE\s*</);
assert.doesNotMatch(sidebar, />\s*Version 1\.0\.0\s*</);

const dashboard = read("components/dashboard/page.tsx");
assert.match(dashboard, /can\("orders"\) && \{\s*href: "\/calculator"/);

const orderList = read("app/api/orders/route.ts");
includesAll(
  orderList,
  [
    "role !== Role.DIRECTOR && role !== Role.MANAGER",
    '"partnerPrice" in body',
    '"partnerPaid" in body',
    "delete result.companyProfit",
    '"partnerAgreedAt"',
    '"partnerBalance"',
    "partnerAgreedAt: { not: null }",
  ],
  "orders API",
);

const orderDetail = read("app/api/orders/[id]/route.ts");
includesAll(
  orderDetail,
  [
    "canAccessOrder360(",
    "{ includeDeleted }",
    "delete result.amount",
    "delete result.prepayment",
    "delete result.balance",
    "delete result.payments",
    "delete result.calculations",
    '"workshopCost"',
    '"grossProfit"',
    "delete line.unitCost",
    "delete line.totalCost",
  ],
  "order detail redaction",
);

const calculation = read("app/api/orders/[id]/calculation/route.ts");
includesAll(
  calculation,
  [
    "where: { id, partnerId: partner.id, deletedAt: null }",
    "if (role === Role.PARTNER)",
    'if ("workshopCost" in body && role !== Role.DIRECTOR)',
    "delete result.grossProfit",
    "delete result[key]",
  ],
  "calculator boundary",
);

const tariffs = read("lib/calculator/tariffs.ts");
assert.match(tariffs, /delete result\.internalPrice/);

const payments = read("app/api/payments/route.ts");
const partnerPaymentBranch = payments.slice(
  payments.indexOf("const partner ="),
  payments.indexOf("return NextResponse.json(payments)"),
);
includesAll(
  partnerPaymentBranch,
  [
    'type: "PARTNER_PAYOUT"',
    "order: { partnerId: partner.id, deletedAt: null }",
    "order: { select: { id: true, number: true } }",
  ],
  "partner payment scope",
);
assert.doesNotMatch(
  partnerPaymentBranch,
  /client:\s*true|include:\s*\{\s*order/,
);
assert.match(
  payments,
  /user\.role === Role\.PARTNER[\s\S]*Цех не может создавать финансовые операции/,
);

const finance = read("app/api/finance/route.ts");
const partnerFinanceGuard = finance.indexOf(
  "auth.session!.user.role !== Role.DIRECTOR && auth.session!.user.role !== Role.ACCOUNTANT",
);
assert.ok(partnerFinanceGuard > 0, "finance role guard is missing");
assert.ok(
  partnerFinanceGuard <
    finance.indexOf("getFinanceDashboard({", partnerFinanceGuard),
  "partner ledger guard must run before the general finance query",
);

const documents = read("lib/services/document.service.ts");
assert.match(
  documents,
  /order:\s*\{ deletedAt: null, partnerId: ownerPartnerId \}/,
);

const calendar = read("lib/services/calendar.service.ts");
includesAll(
  calendar,
  [
    "if (actor.role === Role.DIRECTOR) return {}",
    "if (actor.role === Role.MANAGER)",
    "return { assigneeId: actor.userId }",
    "actor.userId === assigneeId",
    "FORBIDDEN_RELATION",
    "RELATION_MISMATCH",
  ],
  "calendar ownership",
);

const production = read("lib/production/access-policy.ts");
includesAll(
  production,
  [
    "production.masterUserId !== userId",
    "role === Role.PRODUCTION",
    "role === Role.INSTALLER",
    "role === Role.INSTALLER && production.stage ===",
  ],
  "production ownership",
);

const securityApi = read("scripts/test-api-security.ts");
includesAll(
  securityApi,
  [
    "assertProductionPayload",
    "assertCalendarPayload",
    "production payload contains a foreign record",
    "production warehouse scope is invalid",
  ],
  "DB security acceptance suite",
);

const partnerApiSources = [
  "app/api/partner/dashboard/route.ts",
  "app/api/partner/profile/route.ts",
  "app/api/partners/payments/route.ts",
]
  .map(read)
  .join("\n");
assert.doesNotMatch(
  partnerApiSources,
  /Partner access only|Partner profile not found|Invalid partner payout|Order not found|Unable to create partner payout|Insufficient permissions/,
);

console.log("role-based acceptance checks passed");
