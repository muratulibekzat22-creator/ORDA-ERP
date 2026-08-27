import "./require-test-database";

import assert from "node:assert/strict";
import { DocumentStatus, DocumentType, OrderLifecycle, Role } from "@prisma/client";

import { prisma } from "../lib/prisma";
import { buildManagerOrderAttention } from "../lib/orders/manager-attention";
import { getDashboardSummary } from "../lib/services/dashboard.service";
import {
  getDirectorManagerOwnershipIssues,
  getManagerMorningReviewState,
} from "../lib/services/manager-morning-review.service";
import {
  runWithSystemAccess,
  runWithTenant,
  type TenantIdentity,
} from "../lib/tenant-context";

if (process.env.LIVE_RELEASE_CLONE_TEST !== "true")
  throw new Error("LIVE_RELEASE_CLONE_TEST=true is required");

const emails = {
  director: "bekzat@altynsapa.kz",
  gulsim: "gulsim@altynsapa.kz",
  akbota: "akbota@altynsapa.kz",
} as const;

async function main() {
  const snapshot = await runWithSystemAccess(async () => {
    const liveCompany = await prisma.company.findUniqueOrThrow({ where: { id: 1 } });
    const demoCompany = await prisma.company.findUniqueOrThrow({ where: { id: 2 } });
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true, email: true, role: true, active: true, companyId: true },
    });
    return { liveCompany, demoCompany, users };
  });
  assert.equal(snapshot.liveCompany.isDemo, false);
  assert.equal(snapshot.demoCompany.isDemo, true);
  const byEmail = new Map(snapshot.users.map((user) => [user.email, user]));
  const director = byEmail.get(emails.director);
  const gulsim = byEmail.get(emails.gulsim);
  const akbota = byEmail.get(emails.akbota);
  assert(director && director.companyId === 1 && director.role === Role.DIRECTOR && director.active);
  assert(gulsim && gulsim.companyId === 1 && gulsim.role === Role.MANAGER && gulsim.active);
  assert(akbota && akbota.companyId === 1 && akbota.role === Role.MANAGER && akbota.active);

  const live: TenantIdentity = {
    companyId: snapshot.liveCompany.id,
    companySlug: snapshot.liveCompany.slug,
    companyName: snapshot.liveCompany.name,
    isDemo: false,
  };
  const demo: TenantIdentity = {
    companyId: snapshot.demoCompany.id,
    companySlug: snapshot.demoCompany.slug,
    companyName: snapshot.demoCompany.name,
    isDemo: true,
  };

  const result = await runWithTenant(live, async () => {
    const [clients, orders, proposals, contracts, controlOrder, ownershipIssues] =
      await Promise.all([
        prisma.client.count({ where: { active: true, deletedAt: null } }),
        prisma.order.count({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } } }),
        prisma.commercialProposal.count(),
        prisma.document.count({
          where: {
            type: DocumentType.CONTRACT,
            status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] },
          },
        }),
        prisma.order.findFirst({
          where: { number: "ORD-20260818-056331CAF547", deletedAt: null },
          select: {
            id: true,
            companyId: true,
            managerUserId: true,
            client: { select: { name: true } },
            documents: { select: { id: true, type: true } },
            payments: { select: { id: true } },
          },
        }),
        getDirectorManagerOwnershipIssues(),
      ]);
    assert(clients > 0 && orders > 0 && proposals > 0 && contracts > 0);
    assert(controlOrder && controlOrder.companyId === 1 && controlOrder.managerUserId === gulsim.id);
    assert.equal(ownershipIssues.length, 0, "LIVE clone contains unresolved manager ownership");

    const managerWhere = (userId: number) => ({
      deletedAt: null,
      lifecycle: { not: OrderLifecycle.CANCELLED },
      OR: [{ managerUserId: userId }, { leadConversion: { managerId: userId } }],
    });
    const [gulsimOrders, akbotaOrders, gulsimMorning, akbotaMorning, directorDashboard, gulsimDashboard] =
      await Promise.all([
        prisma.order.findMany({ where: managerWhere(gulsim.id), select: { id: true } }),
        prisma.order.findMany({ where: managerWhere(akbota.id), select: { id: true } }),
        getManagerMorningReviewState(gulsim.id),
        getManagerMorningReviewState(akbota.id),
        getDashboardSummary({ role: Role.DIRECTOR, userId: director.id, period: "month" }),
        getDashboardSummary({ role: Role.MANAGER, userId: gulsim.id, period: "month" }),
      ]);
    assert(gulsimOrders.length > 0 && akbotaOrders.length > 0);
    const gulsimIds = new Set(gulsimOrders.map((order) => order.id));
    assert.equal(akbotaOrders.some((order) => gulsimIds.has(order.id)), false);
    assert.equal(gulsimMorning.inventory.managerOrderCount, gulsimOrders.length);
    assert.equal(akbotaMorning.inventory.managerOrderCount, akbotaOrders.length);
    assert(gulsimMorning.orders.every((order) => gulsimIds.has(order.id)));
    assert((directorDashboard.metrics as { orders: number }).orders > 0);
    assert((gulsimDashboard as { managerOrderAttention?: ReturnType<typeof buildManagerOrderAttention>[] }).managerOrderAttention?.length);
    return {
      clients,
      orders,
      proposals,
      contracts,
      gulsimOrders: gulsimOrders.length,
      akbotaOrders: akbotaOrders.length,
      controlOrderDocuments: controlOrder.documents.length,
      controlOrderPayments: controlOrder.payments.length,
    };
  });

  await runWithTenant(demo, async () => {
    assert.equal(await prisma.order.count({ where: { number: "ORD-20260818-056331CAF547" } }), 0);
  });
  console.log(JSON.stringify({ liveDataVisibility: "PASS", ...result }));
}

void main().finally(() => prisma.$disconnect());
