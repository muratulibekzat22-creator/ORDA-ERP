import "./require-test-database";

import assert from "node:assert/strict";
import {
  CalendarTaskType,
  DocumentSource,
  DocumentStatus,
  DocumentType,
  MeasurementStatus,
  PayrollAccrualType,
  PayrollDirection,
  Role,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import {
  deleteOrderFromWork,
  OrderDeletionError,
  restoreOrder,
} from "@/lib/services/order-deletion.service";
import { getOrders } from "@/lib/services/order.service";
import { getFinanceDashboard } from "@/lib/services/payment.service";
import { getProductions } from "@/lib/services/production.service";

if (
  !process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
)
  throw new Error(
    "Order soft-delete integration requires DATABASE_URL=TEST_DATABASE_URL",
  );

const tag = `order-soft-delete-${Date.now()}`;
const ids = {
  users: [] as number[],
  clients: [] as number[],
  orders: [] as number[],
  partner: 0,
  profile: 0,
  period: 0,
};

async function cleanup() {
  if (ids.orders.length) {
    const measurements = await prisma.measurement.findMany({
      where: { orderId: { in: ids.orders } },
      select: { id: true, calendarTaskId: true },
    });
    const measurementIds = measurements.map((item) => item.id);
    const taskIds = measurements
      .map((item) => item.calendarTaskId)
      .filter((id): id is number => id !== null);
    const documents = await prisma.document.findMany({
      where: { orderId: { in: ids.orders } },
      select: { id: true },
    });
    const documentIds = documents.map((item) => item.id);
    const productions = await prisma.production.findMany({
      where: { orderId: { in: ids.orders } },
      select: { id: true },
    });
    const productionIds = productions.map((item) => item.id);

    if (documentIds.length) {
      await prisma.documentAudit.deleteMany({
        where: { documentId: { in: documentIds } },
      });
      await prisma.documentVersion.deleteMany({
        where: { documentId: { in: documentIds } },
      });
      await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
    }
    if (measurementIds.length) {
      await prisma.payrollAccrual.deleteMany({
        where: { measurementId: { in: measurementIds } },
      });
      await prisma.measurementAudit.deleteMany({
        where: { measurementId: { in: measurementIds } },
      });
      await prisma.measurementAttachment.deleteMany({
        where: { measurementId: { in: measurementIds } },
      });
      await prisma.measurement.deleteMany({
        where: { id: { in: measurementIds } },
      });
    }
    if (taskIds.length) {
      await prisma.calendarTaskAudit.deleteMany({
        where: { taskId: { in: taskIds } },
      });
      await prisma.calendarTask.deleteMany({ where: { id: { in: taskIds } } });
    }
    if (productionIds.length) {
      await prisma.productionStageHistory.deleteMany({
        where: { productionId: { in: productionIds } },
      });
      await prisma.production.deleteMany({
        where: { id: { in: productionIds } },
      });
    }
    await prisma.payrollAccrual.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.partnerAssignmentHistory.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.financeAuditEvent.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.companyLedgerEntry.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.payment.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.orderStatusHistory.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.orderEvent.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.orderLifecycleEvent.deleteMany({
      where: { orderId: { in: ids.orders } },
    });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  }
  if (ids.clients.length) {
    await prisma.commercialProposal.deleteMany({
      where: { clientId: { in: ids.clients } },
    });
    await prisma.leadCalculation.deleteMany({
      where: { clientId: { in: ids.clients } },
    });
    await prisma.client.deleteMany({ where: { id: { in: ids.clients } } });
  }
  if (ids.profile)
    await prisma.employeePayrollProfile.delete({ where: { id: ids.profile } });
  if (ids.period)
    await prisma.payrollPeriod.delete({ where: { id: ids.period } });
  if (ids.partner) await prisma.partner.delete({ where: { id: ids.partner } });
  if (ids.users.length)
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function createClient(
  manager: { id: number; name: string },
  suffix: string,
) {
  const client = await prisma.client.create({
    data: {
      name: `${tag}-${suffix}`,
      phone: `+7707${String(ids.clients.length + 1).padStart(7, "0")}`,
      whatsapp: `+7707${String(ids.clients.length + 1).padStart(7, "0")}`,
      city: "Алматы",
      address: "Тестовый адрес",
      manager: manager.name,
      managerUserId: manager.id,
      amount: "1000000",
      status: "QUALIFIED",
    },
  });
  ids.clients.push(client.id);
  return client;
}

async function createOrder(
  clientId: number,
  manager: { id: number; name: string },
  suffix: string,
) {
  const order = await prisma.order.create({
    data: {
      number: `${tag}-${suffix}`,
      clientId,
      address: "Тестовый адрес",
      staircase: "П-образная",
      material: "Дуб",
      amount: 1_000_000,
      prepayment: 250_000,
      balance: 750_000,
      partnerPrice: 500_000,
      partnerBalance: 500_000,
      companyProfit: 500_000,
      manager: manager.name,
      managerUserId: manager.id,
    },
  });
  ids.orders.push(order.id);
  return order;
}

async function main() {
  const [director, gulsim, akbota, measurer] = await Promise.all([
    prisma.user.create({
      data: {
        name: `${tag}-director`,
        email: `${tag}-director@test.local`,
        password: "test",
        role: Role.DIRECTOR,
      },
    }),
    prisma.user.create({
      data: {
        name: `${tag}-gulsim`,
        email: `${tag}-gulsim@test.local`,
        password: "test",
        role: Role.MANAGER,
      },
    }),
    prisma.user.create({
      data: {
        name: `${tag}-akbota`,
        email: `${tag}-akbota@test.local`,
        password: "test",
        role: Role.MANAGER,
      },
    }),
    prisma.user.create({
      data: {
        name: `${tag}-measurer`,
        email: `${tag}-measurer@test.local`,
        password: "test",
        role: Role.MEASURER,
      },
    }),
  ]);
  ids.users.push(director.id, gulsim.id, akbota.id, measurer.id);
  const directorActor = {
    userId: director.id,
    role: Role.DIRECTOR,
    name: director.name,
  };
  const gulsimActor = {
    userId: gulsim.id,
    role: Role.MANAGER,
    name: gulsim.name,
  };
  const akbotaActor = {
    userId: akbota.id,
    role: Role.MANAGER,
    name: akbota.name,
  };

  try {
    const [clientA, clientB] = await Promise.all([
      createClient(gulsim, "client-a"),
      createClient(akbota, "client-b"),
    ]);
    const [orderA, orderB] = await Promise.all([
      createOrder(clientA.id, gulsim, "order-a"),
      createOrder(clientB.id, akbota, "order-b"),
    ]);

    const partner = await prisma.partner.create({
      data: { name: `${tag}-partner` },
    });
    ids.partner = partner.id;
    await prisma.order.update({
      where: { id: orderA.id },
      data: { partnerId: partner.id, partnerAgreedAt: new Date() },
    });

    const task = await prisma.calendarTask.create({
      data: {
        title: `${tag}-measurement`,
        type: CalendarTaskType.MEASUREMENT,
        dueAt: new Date(Date.now() + 86_400_000),
        assigneeId: measurer.id,
        creatorId: gulsim.id,
        clientId: clientA.id,
        orderId: orderA.id,
      },
    });
    const measurement = await prisma.measurement.create({
      data: {
        orderId: orderA.id,
        clientId: clientA.id,
        calendarTaskId: task.id,
        measurer: measurer.name,
        measurerUserId: measurer.id,
        visitDate: task.dueAt,
        status: MeasurementStatus.ASSIGNED,
      },
    });
    const calculation = await prisma.leadCalculation.create({
      data: {
        clientId: clientA.id,
        material: "Дуб",
        baseClientPrice: 1_000_000,
        clientPrice: 1_000_000,
        internalCost: 500_000,
        snapshot: { tag },
        authorId: gulsim.id,
        authorName: gulsim.name,
      },
    });
    const proposal = await prisma.commercialProposal.create({
      data: {
        clientId: clientA.id,
        calculationId: calculation.id,
        number: `${tag}-proposal`,
        snapshot: { tag },
        validUntil: new Date(Date.now() + 3 * 86_400_000),
        executionTerm: "40–50 дней",
        paymentTerms: "50/50",
        warranty: "1 год",
        managerContact: gulsim.name,
        createdById: gulsim.id,
        createdByName: gulsim.name,
      },
    });
    const document = await prisma.document.create({
      data: {
        clientId: clientA.id,
        orderId: orderA.id,
        type: DocumentType.CONTRACT,
        number: `${tag}-contract`,
        title: "Подписанный договор",
        documentDate: new Date(),
        status: DocumentStatus.SIGNED,
        source: DocumentSource.GENERATED_ORDER,
        authorId: gulsim.id,
        signedAt: new Date(),
      },
    });
    const payment = await prisma.payment.create({
      data: {
        orderId: orderA.id,
        amount: 250_000,
        type: "CLIENT_PAYMENT",
        method: "CASH",
        author: gulsim.name,
        idempotencyKey: `${tag}-payment`,
        requestHash: tag,
      },
    });
    const partnerHistory = await prisma.partnerAssignmentHistory.create({
      data: {
        orderId: orderA.id,
        newPartnerId: partner.id,
        previousPayable: 0,
        newPayable: 500_000,
        paidAtChange: 0,
        remainingAtChange: 500_000,
        reason: "Согласовано",
        authorId: director.id,
      },
    });
    const profile = await prisma.employeePayrollProfile.create({
      data: {
        userId: gulsim.id,
        name: gulsim.name,
        position: "Менеджер",
        hiredAt: new Date(),
      },
    });
    ids.profile = profile.id;
    const period = await prisma.payrollPeriod.create({
      data: { year: 2199, month: 12 },
    });
    ids.period = period.id;
    const accrual = await prisma.payrollAccrual.create({
      data: {
        employeeId: profile.id,
        periodId: period.id,
        type: PayrollAccrualType.ORDER_BONUS,
        direction: PayrollDirection.INCREASE,
        amount: 20_000,
        orderId: orderA.id,
        reason: "Бонус за заказ",
        approvedById: director.id,
        createdById: director.id,
        idempotencyKey: `${tag}-accrual`,
        requestHash: tag,
      },
    });
    const incompleteProduction = await prisma.production.create({
      data: {
        orderId: orderA.id,
        stage: "Изготовление",
        percent: 40,
        master: "Цех",
      },
    });
    const completedProduction = await prisma.production.create({
      data: {
        orderId: orderA.id,
        stage: "Сдано",
        percent: 100,
        master: "Цех",
        completedAt: new Date(),
        actualEndAt: new Date(),
      },
    });
    const independentlyArchivedProduction = await prisma.production.create({
      data: {
        orderId: orderA.id,
        stage: "Подготовка",
        percent: 10,
        master: "Цех",
        archivedAt: new Date(),
        archiveReason: "MANUAL_CANCELLED",
      },
    });

    await assert.rejects(
      () => deleteOrderFromWork(gulsimActor, orderB.id),
      (error) =>
        error instanceof OrderDeletionError && error.message === "FORBIDDEN",
    );
    const akbotaDeleted = await deleteOrderFromWork(akbotaActor, orderB.id);
    assert.equal(akbotaDeleted.alreadyDeleted, false);
    await assert.rejects(
      () => restoreOrder(akbotaActor, orderB.id),
      (error) =>
        error instanceof OrderDeletionError && error.message === "FORBIDDEN",
    );
    await restoreOrder(directorActor, orderB.id);
    await deleteOrderFromWork(directorActor, orderB.id, "Проверка директора");
    await restoreOrder(directorActor, orderB.id);

    const dashboardBefore = await getDashboardSummary({
      role: Role.DIRECTOR,
      userId: director.id,
      period: "month",
    });
    const deleted = await deleteOrderFromWork(
      gulsimActor,
      orderA.id,
      "Создано ошибочно",
    );
    assert.equal(deleted.alreadyDeleted, false);
    assert.equal(deleted.impact.payments, 1);
    assert.equal(deleted.impact.documents, 1);
    assert.equal(deleted.impact.measurements, 1);
    assert.equal(deleted.impact.partnerSettlements, 1);
    assert.equal(deleted.impact.payrollAccruals, 1);

    const archivedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderA.id },
    });
    assert.ok(archivedOrder.deletedAt);
    assert.equal(archivedOrder.deletedById, gulsim.id);
    assert.equal(
      await prisma.orderLifecycleEvent.count({
        where: { orderId: orderA.id, type: "ORDER_DELETED" },
      }),
      1,
    );
    assert.equal(
      (await getOrders()).some((item) => item.id === orderA.id),
      false,
    );
    assert.equal(
      (
        await getOrders({ deletedAt: { not: null } }, { includeDeleted: true })
      ).some((item) => item.id === orderA.id),
      true,
    );
    assert.equal(
      (await getProductions()).some((item) => item.orderId === orderA.id),
      false,
    );

    const dashboardAfter = await getDashboardSummary({
      role: Role.DIRECTOR,
      userId: director.id,
      period: "month",
    });
    const beforeMetrics = dashboardBefore.metrics as { orders: number };
    const afterMetrics = dashboardAfter.metrics as { orders: number };
    assert.equal(
      afterMetrics.orders,
      beforeMetrics.orders - 1,
    );
    const finance = await getFinanceDashboard({ orderId: orderA.id });
    assert.equal(
      finance.rows.length,
      0,
      "Archived order must leave active finance cards",
    );
    assert.ok(
      finance.operations.some(
        (item) => item.sourceId === payment.id && item.source === "PAYMENT",
      ),
      "Canonical payment history must remain visible in finance history",
    );

    assert.ok(
      await prisma.measurement.findUnique({ where: { id: measurement.id } }),
    );
    assert.ok(await prisma.calendarTask.findUnique({ where: { id: task.id } }));
    assert.ok(
      await prisma.commercialProposal.findUnique({
        where: { id: proposal.id },
      }),
    );
    assert.ok(await prisma.document.findUnique({ where: { id: document.id } }));
    assert.ok(await prisma.payment.findUnique({ where: { id: payment.id } }));
    assert.ok(
      await prisma.partnerAssignmentHistory.findUnique({
        where: { id: partnerHistory.id },
      }),
    );
    assert.ok(
      await prisma.payrollAccrual.findUnique({ where: { id: accrual.id } }),
    );
    assert.ok(
      (
        await prisma.production.findUniqueOrThrow({
          where: { id: incompleteProduction.id },
        })
      ).archivedAt,
    );
    assert.equal(
      (
        await prisma.production.findUniqueOrThrow({
          where: { id: completedProduction.id },
        })
      ).archivedAt,
      null,
    );

    const replay = await deleteOrderFromWork(gulsimActor, orderA.id);
    assert.equal(replay.alreadyDeleted, true);
    assert.equal(
      await prisma.orderLifecycleEvent.count({
        where: { orderId: orderA.id, type: "ORDER_DELETED" },
      }),
      1,
    );

    const restored = await restoreOrder(directorActor, orderA.id);
    assert.equal(restored.alreadyRestored, false);
    assert.equal(
      (await prisma.order.findUniqueOrThrow({ where: { id: orderA.id } }))
        .deletedAt,
      null,
    );
    assert.equal(
      (
        await prisma.production.findUniqueOrThrow({
          where: { id: incompleteProduction.id },
        })
      ).archivedAt,
      null,
    );
    assert.ok(
      (
        await prisma.production.findUniqueOrThrow({
          where: { id: independentlyArchivedProduction.id },
        })
      ).archivedAt,
      "Restore must not resurrect independently archived production",
    );
    assert.equal(
      await prisma.orderLifecycleEvent.count({
        where: { orderId: orderA.id, type: "ORDER_RESTORED" },
      }),
      1,
    );

    console.log(
      "order soft-delete ownership, archive/restore, dashboard exclusion and A-H relation preservation passed",
    );
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
