import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { ensureDailyManagerOperations } from "@/lib/services/daily-operations.service";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("Daily manager operations preparation skipped outside production");
    return;
  }
  const slug = process.env.FOUNDER_CONTROL_COMPANY_SLUG?.trim();
  if (!slug) throw new Error("FOUNDER_CONTROL_COMPANY_SLUG is missing");
  const company = await runWithSystemAccess(() => prisma.company.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, active: true, isDemo: true },
  }));
  if (!company?.active || company.isDemo) throw new Error("Live company is unavailable");
  const result = await runWithTenant({ companyId: company.id, companySlug: company.slug, companyName: company.name, isDemo: false }, async () => {
    const founders = await prisma.user.findMany({ where: { active: true, role: "DIRECTOR" }, select: { id: true } });
    if (founders.length !== 1) throw new Error(`Expected one founder, found ${founders.length}`);
    return ensureDailyManagerOperations(founders[0].id);
  });
  console.log(`Daily manager operations prepared: ${JSON.stringify(result)}`);
}

main().finally(() => prisma.$disconnect());
