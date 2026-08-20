import "./require-test-database";

import { PartnerBusinessType, PartnerRewardRule, PartnerSettlementOperationType, Role } from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import {
  createManagedPartner,
  createPartnerOrder,
  createPartnerSettlementOperation,
  linkPartnerOrder,
  type PartnerManagementActor,
} from "@/lib/services/partner-management.service";
import { createOrder } from "@/lib/services/order.service";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

const DEMO_COMPANY_ID = 2;
const seedVersion = "partner-management-demo-v2";
const partnerNames = [
  "Demo · Arman Recommendations", "Demo · Qadam Sales", "Demo · Asyl Dealer", "Demo · Forma Design",
  "Demo · Arch Line", "Demo · Build Group", "Demo · Qurylys Contractor", "Demo · Other Partner",
];
const kinds = Object.values(PartnerBusinessType);
const rules = [PartnerRewardRule.FIXED, PartnerRewardRule.ORDER_PERCENT, PartnerRewardRule.PAID_PERCENT, PartnerRewardRule.PROFIT_PERCENT] as const;
const cities = ["Алматы", "Караганда", "Астана", "Шымкент", "Отеген батыр", "Конаев", "Талдыкорган", "Каскелен"];

export async function seedPartnerManagementDemo() {
  const setup = await runWithSystemAccess(async () => {
    const company = await prisma.company.findUnique({ where: { id: DEMO_COMPANY_ID }, select: { id: true, slug: true, name: true, isDemo: true } });
    if (!company?.isDemo) throw new Error("DEMO_COMPANY_ID_2_REQUIRED");
    const director = await prisma.user.findFirst({ where: { companyId: DEMO_COMPANY_ID, role: Role.DIRECTOR, active: true }, orderBy: { id: "asc" }, select: { id: true, name: true } });
    if (!director) throw new Error("ACTIVE_DEMO_DIRECTOR_REQUIRED");
    const manager = await prisma.user.findFirst({ where: { companyId: DEMO_COMPANY_ID, role: Role.MANAGER, active: true }, orderBy: { id: "asc" }, select: { id: true, name: true } });
    if (!manager) throw new Error("ACTIVE_DEMO_MANAGER_REQUIRED");
    return { company, director, manager };
  });
  const actor: PartnerManagementActor = { userId: setup.director.id, name: setup.director.name, role: Role.DIRECTOR };
  return runWithTenant({ companyId: setup.company.id, companySlug: setup.company.slug, companyName: setup.company.name, isDemo: true }, async () => {
    const partners = [];
    for (let index = 0; index < partnerNames.length; index += 1) {
      const existing = await prisma.partner.findFirst({ where: { companyId: DEMO_COMPANY_ID, name: partnerNames[index] } });
      const managed = existing && !existing.managementDirectory
        ? await prisma.partner.update({ where: { id: existing.id }, data: { managementDirectory: true } })
        : existing;
      partners.push(managed ?? await createManagedPartner({
        name: partnerNames[index], kind: kinds[index] ?? PartnerBusinessType.OTHER,
        phone: `+7700020${String(index).padStart(4, "0")}`,
        city: cities[index % cities.length], contactPerson: `Demo Contact ${index + 1}`,
        defaultRewardRule: index % 4 === 0 ? PartnerRewardRule.FIXED : rules[index % rules.length],
        defaultRewardFixedAmount: index % 4 === 0 ? "100000" : null,
        defaultRewardPercent: index % 4 === 0 ? null : "10",
        comment: `${seedVersion}; только Demo companyId=2`,
      }, actor));
    }
    const relations = [];
    for (let index = 0; index < 16; index += 1) {
      const partner = partners[index % partners.length];
      const rule = rules[index % rules.length];
      const amount = 1_000_000 + index * 25_000;
      const key = `${seedVersion}:order:${index}`;
      const requestHash = createRequestHash({ key, amount, partnerId: partner.id });
      const client = { name: `Demo Partner Client ${String(index + 1).padStart(2, "0")}`, phone: `+7701200${String(index).padStart(4, "0")}`, city: cities[index % cities.length], address: `Demo object ${index + 1}` };
      const staircase = index % 2 ? "П-образная лестница" : "Прямая лестница";
      const material = index % 3 ? "Ясень" : "Дуб";
      const reward = rule === PartnerRewardRule.FIXED ? { rewardRule: rule, fixedAmount: "100000" } : { rewardRule: rule, rewardPercent: "10" };
      if (index < 4) {
        const existing = await createOrder({
          client, partnerId: partner.id, address: client.address, staircase, material,
          orderReceivedAt: new Date(Date.UTC(2026, 7, 1 + index)), promisedAt: new Date(Date.UTC(2026, 9, 1 + index)),
          additionalDetails: `${seedVersion}:existing`, amount, prepayment: 0, partnerPrice: 0, partnerPriceSet: false, partnerPaid: 0,
          manager: setup.manager.name, managerUserId: setup.manager.id, actorRole: Role.DIRECTOR,
          idempotencyKey: `${key}:existing`, requestHash,
        });
        const linked = await linkPartnerOrder({ partnerId: partner.id, orderId: existing.order.id, reward, comment: seedVersion }, actor);
        relations.push(linked.relation);
      } else {
        const result = await createPartnerOrder({
          partnerId: partner.id, client, staircase, material,
          description: "Demo partner order", address: client.address, amount: String(amount),
          promisedAt: new Date(Date.UTC(2026, 9, 1 + index)), managerUserId: setup.manager.id, status: index % 3 ? "В работе" : "Новый",
          reward, comment: seedVersion, idempotencyKey: key, requestHash,
        }, actor);
        relations.push(result.relation);
      }
    }
    for (let index = 0; index < relations.length; index += 1)
      await prisma.client.update({ where: { id: relations[index].order.client.id }, data: { name: `Demo Partner Client ${String(index + 1).padStart(2, "0")}`, city: cities[index % cities.length] } });
    for (let index = 0; index < relations.length; index += 1) {
      const relation = relations[index];
      const firstType = index % 3 === 1 ? PartnerSettlementOperationType.CLIENT_TO_PARTNER : PartnerSettlementOperationType.CLIENT_TO_COMPANY;
      const firstAmount = index % 3 === 1 ? "300000" : "400000";
      const firstKey = `${seedVersion}:operation:${index}:receipt`;
      await createPartnerSettlementOperation({ relationId: relation.id, type: firstType, amount: firstAmount, operationDate: new Date(Date.UTC(2026, 7, 1 + index)), method: "bank", account: firstType === PartnerSettlementOperationType.CLIENT_TO_COMPANY ? "Demo bank" : "У партнёра", comment: seedVersion, idempotencyKey: firstKey, requestHash: createRequestHash({ firstKey, firstType, firstAmount }) }, actor);
      if (firstType === PartnerSettlementOperationType.CLIENT_TO_PARTNER && index % 2 === 1) {
        const transferKey = `${seedVersion}:operation:${index}:transfer`;
        await createPartnerSettlementOperation({ relationId: relation.id, type: PartnerSettlementOperationType.PARTNER_TO_COMPANY, amount: "100000", operationDate: new Date(Date.UTC(2026, 7, 18 + index)), method: "bank", account: "Demo bank", comment: seedVersion, idempotencyKey: transferKey, requestHash: createRequestHash({ transferKey }) }, actor);
      }
      if (firstType === PartnerSettlementOperationType.CLIENT_TO_COMPANY && index % 4 === 0) {
        const payoutKey = `${seedVersion}:operation:${index}:payout`;
        await createPartnerSettlementOperation({ relationId: relation.id, type: PartnerSettlementOperationType.COMPANY_TO_PARTNER, amount: "50000", operationDate: new Date(Date.UTC(2026, 7, 20 + index)), method: "bank", account: "Demo bank", comment: seedVersion, idempotencyKey: payoutKey, requestHash: createRequestHash({ payoutKey }) }, actor);
      }
    }
    return {
      partners: await prisma.partner.count({ where: { companyId: DEMO_COMPANY_ID, name: { in: partnerNames } } }),
      orders: await prisma.partnerOrderRelation.count({ where: { companyId: DEMO_COMPANY_ID, comment: seedVersion } }),
      operations: await prisma.partnerSettlementOperation.count({ where: { companyId: DEMO_COMPANY_ID, comment: seedVersion } }),
      existingLinked: await prisma.partnerOrderRelation.count({ where: { companyId: DEMO_COMPANY_ID, comment: seedVersion, order: { additionalDetails: { contains: `${seedVersion}:existing` } } } }),
    };
  });
}

if (process.argv[1]?.endsWith("seed-partner-management-demo.ts")) {
  seedPartnerManagementDemo()
    .then((result) => console.log(`Demo partner seed complete: partners=${result.partners}; orders=${result.orders}; operations=${result.operations}`))
    .catch((error) => { console.error(error instanceof Error ? error.message : "DEMO_SEED_FAILED"); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
