import "../../scripts/require-test-database";

import bcrypt from "bcrypt";
import { Permission, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

export const playwrightPassword = "PartnerTest!1";
export const playwrightUsers = {
  director: "partner-playwright-director@test.local",
  manager: "partner-playwright-manager@test.local",
  accountant: "partner-playwright-accountant@test.local",
  marketer: "partner-playwright-marketer@test.local",
} as const;

export default async function setup() {
  const company = { companyId: 1, companySlug: "altyn-sapa-company", companyName: "ALTYN SAPA TEST", isDemo: false };
  await runWithSystemAccess(() => prisma.company.upsert({ where: { id: 1 }, update: { active: true }, create: { id: 1, slug: company.companySlug, name: company.companyName, isDemo: false } }));
  const hash = await bcrypt.hash(playwrightPassword, 8);
  await runWithTenant(company, async () => {
    for (const [role, permission] of [
      [Role.DIRECTOR, Permission.partners],
      [Role.DIRECTOR, Permission.orders],
      [Role.DIRECTOR, Permission.documents],
      [Role.DIRECTOR, Permission.marketing],
      [Role.MANAGER, Permission.orders],
      [Role.MARKETER, Permission.marketing],
      [Role.MARKETER, Permission.calendar],
    ] as const) {
      await prisma.rolePermission.upsert({
        where: { companyId_role_permission: { companyId: company.companyId, role, permission } },
        update: {},
        create: { role, permission },
      });
    }
    for (const [key, email] of Object.entries(playwrightUsers)) {
      const role = key === "director" ? Role.DIRECTOR : key === "manager" ? Role.MANAGER : key === "marketer" ? Role.MARKETER : Role.ACCOUNTANT;
      const existing = await prisma.user.findFirst({ where: { email } });
      if (existing) await prisma.user.update({ where: { id: existing.id }, data: { name: `Partner ${key}`, password: hash, role, active: true, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null } });
      else await prisma.user.create({ data: { name: `Partner ${key}`, email, password: hash, role, active: true, mustChangePassword: false } });
    }
    const marketer = await prisma.user.findUniqueOrThrow({ where: { email: playwrightUsers.marketer } });
    const source = await prisma.marketingSource.upsert({
      where: { companyId_code: { companyId: company.companyId, code: "PW_META" } },
      create: { code: "PW_META", name: "Playwright Meta", platform: "Meta", isPaid: true, system: true },
      update: { active: true },
    });
    await prisma.marketingContactChannel.upsert({
      where: { companyId_code: { companyId: company.companyId, code: "PW_WHATSAPP" } },
      create: { code: "PW_WHATSAPP", name: "Playwright WhatsApp", system: true },
      update: { active: true },
    });
    const campaign = await prisma.marketingCampaign.upsert({
      where: { companyId_platform_externalId: { companyId: company.companyId, platform: "Meta", externalId: "playwright-campaign" } },
      create: { sourceId: source.id, name: "Playwright Campaign", platform: "Meta", startsAt: new Date(), responsibleId: marketer.id, status: "ACTIVE", externalId: "playwright-campaign" },
      update: { responsibleId: marketer.id, status: "ACTIVE" },
    });
    await prisma.marketingMetric.upsert({
      where: { dedupeKey: "playwright-marketing-metric" },
      create: { metricDate: new Date(), platform: "Meta", campaignId: campaign.id, reportedSpend: 100000, impressions: 50000, clicks: 500, messages: 50, platformLeads: 25, importKey: "playwright", dedupeKey: "playwright-marketing-metric", createdById: marketer.id },
      update: { clicks: 500, impressions: 50000 },
    });
  });
  await prisma.$disconnect();
}
