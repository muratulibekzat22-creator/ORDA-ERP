import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { updatePartner } from "@/lib/services/partner.service";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

const requiredPartners = [
  { key: "islam", name: "Ислам", phone: "+77712546464" },
  { key: "rakhmatulla", name: "Рахматулла", phone: "+77473573031" },
] as const;

async function main() {
  if (process.env.VERCEL_ENV !== "production") {
    console.log("WhatsApp partner contact synchronization skipped outside production");
    return;
  }
  const companySlug = process.env.FOUNDER_CONTROL_COMPANY_SLUG?.trim();
  if (!companySlug) throw new Error("FOUNDER_CONTROL_COMPANY_SLUG is missing");
  const company = await runWithSystemAccess(() =>
    prisma.company.findUnique({
      where: { slug: companySlug },
      select: { id: true, slug: true, name: true, active: true, isDemo: true },
    }),
  );
  if (!company?.active || company.isDemo) throw new Error("Live company is unavailable");

  const result = await runWithTenant(
    { companyId: company.id, companySlug: company.slug, companyName: company.name, isDemo: false },
    async () => {
      const updates: Array<{ key: string; partnerId: number; changed: boolean; orderCount: number }> = [];
      for (const required of requiredPartners) {
        const matches = await prisma.partner.findMany({
          where: {
            name: { equals: required.name, mode: "insensitive" },
            isTest: false,
            managementDirectory: false,
          },
          select: { id: true, name: true, phone: true, active: true, archived: true, _count: { select: { orders: true } } },
        });
        if (matches.length !== 1) {
          throw new Error(`Expected exactly one ${required.key} partner, found ${matches.length}`);
        }
        const partner = matches[0]!;
        if (!partner.active || partner.archived) throw new Error(`${required.key} partner is not active`);
        const changed = partner.phone !== required.phone;
        if (changed) {
          await updatePartner(partner.id, { name: partner.name, phone: required.phone, active: true });
        }
        updates.push({ key: required.key, partnerId: partner.id, changed, orderCount: partner._count.orders });
      }
      return updates;
    },
  );
  console.log(`WhatsApp partner contacts synchronized: ${JSON.stringify(result)}`);
}

main().finally(() => prisma.$disconnect());
