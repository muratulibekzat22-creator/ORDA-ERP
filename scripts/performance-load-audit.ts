import "./require-test-database";

import {
  CalendarTaskPriority,
  CalendarTaskStatus,
  CalendarTaskType,
  DocumentSource,
  DocumentStatus,
  DocumentType,
  LeadStage,
  MeasurementStatus,
  OrderLifecycle,
  PayrollAccrualType,
  PayrollDirection,
  PayrollPaymentType,
  Role,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

const PREFIX = "PERF-AUDIT-20260810";
const DAY = 86_400_000;

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function batches<T>(rows: T[], size = 1_000) {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size)
    result.push(rows.slice(index, index + size));
  return result;
}

async function createManyInBatches<T>(
  label: string,
  rows: T[],
  create: (batch: T[]) => Promise<{ count: number }>,
) {
  let count = 0;
  for (const batch of batches(rows)) count += (await create(batch)).count;
  console.log(`${label}: ${count}`);
}

async function seed() {
  check(
    (await prisma.client.count({ where: { source: PREFIX } })) === 0,
    "Synthetic performance data already exists; use a fresh TEST_DATABASE_URL",
  );

  const now = new Date();
  const director = await prisma.user.create({
    data: {
      name: `${PREFIX} Director`,
      email: `${PREFIX.toLowerCase()}-director@example.test`,
      password: "synthetic-non-login-hash",
      role: Role.DIRECTOR,
    },
  });
  const manager = await prisma.user.create({
    data: {
      name: `${PREFIX} Manager`,
      email: `${PREFIX.toLowerCase()}-manager@example.test`,
      password: "synthetic-non-login-hash",
      role: Role.MANAGER,
    },
  });
  const measurer = await prisma.user.create({
    data: {
      name: `${PREFIX} Measurer`,
      email: `${PREFIX.toLowerCase()}-measurer@example.test`,
      password: "synthetic-non-login-hash",
      role: Role.MEASURER,
    },
  });
  const partner = await prisma.partner.create({
    data: { name: `${PREFIX} Partner`, isTest: true },
  });

  await createManyInBatches(
    "clients",
    Array.from({ length: 5_000 }, (_, index) => ({
      name: `${PREFIX} Client ${index.toString().padStart(5, "0")}`,
      phone: `+7700${index.toString().padStart(7, "0")}`,
      whatsapp: `+7700${index.toString().padStart(7, "0")}`,
      city: `City ${index % 25}`,
      address: `Synthetic address ${index}`,
      manager: manager.name,
      managerUserId: manager.id,
      amount: String(500_000 + (index % 40) * 25_000),
      estimatedAmount: 500_000 + (index % 40) * 25_000,
      status: "Synthetic lead",
      stage: index % 11 === 0 ? LeadStage.LOST : index % 7 === 0 ? LeadStage.WON : LeadStage.NEW,
      source: PREFIX,
      active: true,
      createdAt: new Date(now.getTime() - (index % 540) * DAY),
      nextContactAt: new Date(now.getTime() + ((index % 31) - 15) * DAY),
    })),
    (data) => prisma.client.createMany({ data }),
  );

  const clients = await prisma.client.findMany({
    where: { source: PREFIX },
    orderBy: { id: "asc" },
    select: { id: true, createdAt: true },
  });
  check(clients.length === 5_000, "Client seed count mismatch");

  await createManyInBatches(
    "orders",
    Array.from({ length: 10_000 }, (_, index) => {
      const client = clients[index % clients.length];
      const amount = 800_000 + (index % 60) * 50_000;
      const paid = index % 4 === 0 ? amount : Math.round(amount * 0.4);
      const partnerPrice = Math.round(amount * 0.55);
      const partnerPaid = index % 3 === 0 ? partnerPrice : Math.round(partnerPrice * 0.3);
      return {
        number: `${PREFIX}-ORD-${index.toString().padStart(5, "0")}`,
        clientId: client.id,
        partnerId: index % 10 === 0 ? null : partner.id,
        address: `Synthetic order address ${index}`,
        staircase: "Synthetic staircase",
        material: "Synthetic material",
        amount,
        prepayment: paid,
        balance: amount - paid,
        partnerPrice,
        partnerAgreedAt: index % 10 === 0 ? null : client.createdAt,
        partnerPaid,
        partnerBalance: index % 10 === 0 ? 0 : partnerPrice - partnerPaid,
        companyProfit: amount - partnerPrice,
        manager: manager.name,
        managerUserId: manager.id,
        lifecycle:
          index % 17 === 0
            ? OrderLifecycle.CANCELLED
            : index % 8 === 0
              ? OrderLifecycle.COMPLETED
              : OrderLifecycle.IN_PRODUCTION,
        status: "Synthetic order",
        orderReceivedAt: client.createdAt,
        createdAt: client.createdAt,
        productionDeadline: new Date(client.createdAt.getTime() + 45 * DAY),
      };
    }),
    (data) => prisma.order.createMany({ data }),
  );

  const orders = await prisma.order.findMany({
    where: { number: { startsWith: `${PREFIX}-ORD-` } },
    orderBy: { id: "asc" },
    select: { id: true, clientId: true, createdAt: true },
  });
  check(orders.length === 10_000, "Order seed count mismatch");

  await createManyInBatches(
    "measurements",
    Array.from({ length: 10_000 }, (_, index) => {
      const order = orders[index % orders.length];
      const visitDate = new Date(now.getTime() + ((index % 365) - 180) * DAY);
      const cancelled = index % 11 === 0;
      const completed = !cancelled && index % 4 === 0;
      return {
        clientId: order.clientId,
        orderId: order.id,
        measurer: measurer.name,
        measurerUserId: measurer.id,
        visitDate,
        status: cancelled ? MeasurementStatus.CANCELLED : completed ? MeasurementStatus.HANDED_TO_MANAGER : MeasurementStatus.ASSIGNED,
        city: `City ${index % 25}`,
        address: `Synthetic measurement address ${index}`,
        completedAt: completed ? visitDate : null,
        handedAt: completed ? visitDate : null,
        createdAt: new Date(visitDate.getTime() - 2 * DAY),
      };
    }),
    (data) => prisma.measurement.createMany({ data }),
  );

  await createManyInBatches(
    "calendarTasks",
    Array.from({ length: 30_000 }, (_, index) => {
      const order = orders[index % orders.length];
      const dueAt = new Date(now.getTime() + ((index % 365) - 180) * DAY);
      return {
        title: `${PREFIX} Task ${index}`,
        description: "Synthetic calendar load row",
        type: index % 3 === 0 ? CalendarTaskType.MEASUREMENT : CalendarTaskType.TASK,
        dueAt,
        status: index % 5 === 0 ? CalendarTaskStatus.COMPLETED : CalendarTaskStatus.PLANNED,
        priority: index % 20 === 0 ? CalendarTaskPriority.URGENT : CalendarTaskPriority.NORMAL,
        assigneeId: index % 2 === 0 ? measurer.id : manager.id,
        creatorId: director.id,
        clientId: order.clientId,
        orderId: order.id,
        completedAt: index % 5 === 0 ? dueAt : null,
        completedById: index % 5 === 0 ? director.id : null,
        createdAt: new Date(dueAt.getTime() - DAY),
      };
    }),
    (data) => prisma.calendarTask.createMany({ data }),
  );

  await createManyInBatches(
    "payments",
    Array.from({ length: 15_000 }, (_, index) => {
      const order = orders[index % orders.length];
      return {
        orderId: order.id,
        partnerId: index % 5 === 0 ? partner.id : null,
        amount: 10_000 + (index % 50) * 1_000,
        type: index % 5 === 0 ? "PARTNER_PAYOUT" : "CLIENT_PAYMENT",
        method: "SYNTHETIC",
        comment: index === 14_999 ? `${PREFIX} PHASE2-DEEP-PAYMENT-COMMENT` : PREFIX,
        operationDate: new Date(now.getTime() - (index % 540) * DAY),
        author: director.name,
        idempotencyKey: `${PREFIX}-PAY-${index}`,
      };
    }),
    (data) => prisma.payment.createMany({ data }),
  );

  const category = await prisma.financeCategory.create({
    data: { code: `${PREFIX}-GENERAL`, name: "Synthetic category", direction: "EXPENSE" },
  });
  await createManyInBatches(
    "ledgerEntries",
    Array.from({ length: 15_000 }, (_, index) => {
      const order = orders[index % orders.length];
      return {
        type: "SYNTHETIC_EXPENSE",
        category: category.name,
        categoryId: category.id,
        direction: index % 3 === 0 ? "INCOME" : "EXPENSE",
        source: "MANUAL",
        amount: 5_000 + (index % 30) * 500,
        operationDate: new Date(now.getTime() - (index % 540) * DAY),
        method: "SYNTHETIC",
        counterparty: PREFIX,
        orderId: order.id,
        clientId: order.clientId,
        partnerId: index % 4 === 0 ? partner.id : null,
        comment: index === 14_999 ? `${PREFIX} PHASE2-DEEP-LEDGER-COMMENT` : PREFIX,
        authorId: director.id,
        idempotencyKey: `${PREFIX}-LEDGER-${index}`,
      };
    }),
    (data) => prisma.companyLedgerEntry.createMany({ data }),
  );

  await createManyInBatches(
    "documents",
    Array.from({ length: 5_000 }, (_, index) => {
      const order = orders[index];
      return {
        orderId: order.id,
        clientId: order.clientId,
        type: DocumentType.OTHER,
        number: `${PREFIX}-DOC-${index.toString().padStart(5, "0")}`,
        title: `${PREFIX} metadata ${index}`,
        documentDate: order.createdAt,
        status: DocumentStatus.READY,
        source: DocumentSource.UPLOADED,
        authorId: director.id,
        currentVersion: 0,
        createdAt: order.createdAt,
      };
    }),
    (data) => prisma.document.createMany({ data }),
  );

  await createManyInBatches(
    "productionRows",
    orders.map((order, index) => ({
      orderId: order.id,
      stage: index % 4 === 0 ? "Покраска" : "Каркас",
      percent: index % 100,
      master: `${PREFIX} Master`,
      plannedEndAt: new Date(now.getTime() + ((index % 90) - 45) * DAY),
      createdAt: order.createdAt,
    })),
    (data) => prisma.production.createMany({ data }),
  );

  const profile = await prisma.employeePayrollProfile.create({
    data: {
      userId: manager.id,
      name: manager.name,
      position: "Manager",
      hiredAt: new Date(now.getTime() - 720 * DAY),
      baseSalary: 300_000,
    },
  });
  const periods: Array<{ id: number }> = [];
  for (let offset = 0; offset < 24; offset += 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
    periods.push(
      await prisma.payrollPeriod.create({
        data: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 },
      }),
    );
  }
  await createManyInBatches(
    "payrollAccruals",
    Array.from({ length: 1_200 }, (_, index) => ({
      employeeId: profile.id,
      periodId: periods[index % periods.length].id,
      type: PayrollAccrualType.ORDER_BONUS,
      direction: PayrollDirection.INCREASE,
      amount: 20_000,
      reason: PREFIX,
      approvedById: director.id,
      createdById: director.id,
      idempotencyKey: `${PREFIX}-ACCRUAL-${index}`,
      requestHash: PREFIX,
      createdAt: new Date(now.getTime() - (index % 540) * DAY),
    })),
    (data) => prisma.payrollAccrual.createMany({ data }),
  );
  await createManyInBatches(
    "payrollPayments",
    Array.from({ length: 1_000 }, (_, index) => ({
      employeeId: profile.id,
      periodId: periods[index % periods.length].id,
      amount: 15_000,
      paymentDate: new Date(now.getTime() - (index % 540) * DAY),
      type: PayrollPaymentType.ORDER_BONUS_PAYMENT,
      method: "SYNTHETIC",
      comment: PREFIX,
      paidById: director.id,
      idempotencyKey: `${PREFIX}-PAYROLL-${index}`,
      requestHash: PREFIX,
      createdAt: new Date(now.getTime() - (index % 540) * DAY),
    })),
    (data) => prisma.payrollPayment.createMany({ data }),
  );

  const counts = {
    clients: await prisma.client.count({ where: { source: PREFIX } }),
    orders: await prisma.order.count({ where: { number: { startsWith: `${PREFIX}-ORD-` } } }),
    measurements: await prisma.measurement.count({ where: { measurer: measurer.name } }),
    calendarTasks: await prisma.calendarTask.count({ where: { title: { startsWith: PREFIX } } }),
    financeOperations:
      (await prisma.payment.count({ where: { comment: { startsWith: PREFIX } } })) +
      (await prisma.companyLedgerEntry.count({ where: { comment: { startsWith: PREFIX } } })),
    documents: await prisma.document.count({ where: { number: { startsWith: `${PREFIX}-DOC-` } } }),
    payrollRows:
      (await prisma.payrollAccrual.count({ where: { reason: PREFIX } })) +
      (await prisma.payrollPayment.count({ where: { comment: PREFIX } })),
    productionRows: await prisma.production.count({ where: { master: `${PREFIX} Master` } }),
  };
  console.log(JSON.stringify({ actors: { directorId: director.id, managerId: manager.id, measurerId: measurer.id }, counts }, null, 2));
}

seed()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
