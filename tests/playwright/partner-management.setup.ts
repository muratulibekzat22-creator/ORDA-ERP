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
    const manager = await prisma.user.findUniqueOrThrow({ where: { email: playwrightUsers.manager } });
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
    let contentClient = await prisma.client.findFirst({
      where: { phone: "+77000003218", deletedAt: null },
    });
    if (!contentClient) contentClient = await prisma.client.create({
      data: {
        name: "Playwright Content Client",
        phone: "+77000003218",
        whatsapp: "+77000003218",
        city: "Алматы",
        address: "Абая 10",
        manager: manager.name,
        managerUserId: manager.id,
        amount: "0",
        status: "Завершена",
      },
    });
    const contentOrder = await prisma.order.upsert({
      where: { number: "PW-CONTENT-ORDER" },
      update: {
        clientId: contentClient.id,
        manager: manager.name,
        managerUserId: manager.id,
        completedAt: new Date(),
        lifecycle: "COMPLETED",
      },
      create: {
        number: "PW-CONTENT-ORDER",
        clientId: contentClient.id,
        address: "Абая 10",
        staircase: "П-образная",
        material: "Ясень",
        amount: 0,
        balance: 0,
        manager: manager.name,
        managerUserId: manager.id,
        status: "Заказ завершён",
        lifecycle: "COMPLETED",
        completedAt: new Date(),
      },
    });
    await prisma.marketingContentTask.upsert({
      where: { orderId: contentOrder.id },
      update: { assignedMarketerId: marketer.id, status: "NEW" },
      create: {
        orderId: contentOrder.id,
        clientId: contentClient.id,
        assignedMarketerId: marketer.id,
        createdById: manager.id,
        status: "NEW",
      },
    });
  });
  await prisma.$disconnect();
}
