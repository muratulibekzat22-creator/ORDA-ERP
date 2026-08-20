import "./require-test-database";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { prisma } from "@/lib/prisma";
import { runWithSystemAccess } from "@/lib/tenant-context";

const schema = readFileSync("prisma/schema.prisma", "utf8");
for (const model of [
  "PayrollAccrual",
  "PayrollPayment",
  "PartnerOrderRelation",
  "PartnerSettlementOperation",
  "MarketingSource",
  "MarketingCampaign",
  "MarketingInquiry",
  "LeadAttribution",
  "MarketingSpend",
]) assert.match(schema, new RegExp(`model ${model} \\{`), `${model} is missing from the combined Prisma schema`);

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
assert.doesNotMatch(packageJson.scripts["vercel-build"], /migrate|seed/u);
for (const command of ["test:payroll", "test:partner-management", "test:marketing", "test:final-integration"])
  assert.match(packageJson.scripts.test, new RegExp(command.replace(":", "\\:")));

const routeShell = readFileSync("components/layout/RouteShell.tsx", "utf8");
assert.match(routeShell, /\/partner-management/u);
assert.match(routeShell, /\/marketing/u);

async function main() {
  const result = await runWithSystemAccess(async () => {
    const company = await prisma.company.findUnique({ where: { id: 2 }, select: { slug: true, isDemo: true } });
    const [payroll, partners, marketing] = await Promise.all([
      prisma.employeePayrollProfile.count({ where: { companyId: 2 } }),
      prisma.partnerOrderRelation.count({ where: { companyId: 2 } }),
      prisma.marketingCampaign.count({ where: { companyId: 2 } }),
    ]);
    return { company, payroll, partners, marketing };
  });
  assert.deepEqual(result.company, { slug: "altyn-sapa-demo", isDemo: true });
  assert.ok(result.payroll > 0, "Payroll Demo data is missing");
  assert.ok(result.partners > 0, "Partners Demo data is missing");
  assert.ok(result.marketing > 0, "Marketing Demo data is missing");
  console.log(`Combined integration passed: payroll=${result.payroll}; partners=${result.partners}; marketing=${result.marketing}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
