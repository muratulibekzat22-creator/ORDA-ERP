import "./require-test-database";

import assert from "node:assert/strict";
import { CalendarTaskPriority, CalendarTaskType, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  ClientDeletionError,
  forceDeleteClient,
  previewClientForceDelete,
} from "@/lib/services/client-force-delete.service";

if (
  !process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL
)
  throw new Error("Client force-delete integration requires TEST_DATABASE_URL");

const tag = `client-force-delete-${Date.now()}`;

async function main() {
  const director = await prisma.user.create({
    data: {
      name: `${tag}-director`,
      email: `${tag}-director@test.local`,
      password: "not-used",
      role: Role.DIRECTOR,
    },
  });
  const manager = await prisma.user.create({
    data: {
      name: `${tag}-manager`,
      email: `${tag}-manager@test.local`,
      password: "not-used",
      role: Role.MANAGER,
    },
  });
  const directorActor = {
    userId: director.id,
    role: Role.DIRECTOR,
    name: director.name,
  };
  const managerActor = {
    userId: manager.id,
    role: Role.MANAGER,
    name: manager.name,
  };
  let blockedClientId = 0;
  let blockedOrderId = 0;
  try {
    const client = await prisma.client.create({
      data: {
        name: `${tag}-safe`,
        phone: `+7${String(Date.now()).slice(-10)}`,
        city: "TEST",
        manager: manager.name,
        managerUserId: manager.id,
        amount: "500000",
        status: "QUALIFIED",
      },
    });
    const calculation = await prisma.leadCalculation.create({
      data: {
        clientId: client.id,
        material: "Сосна",
        baseClientPrice: 500000,
        clientPrice: 500000,
        internalCost: 1,
        snapshot: { public: true },
        authorId: manager.id,
        authorName: manager.name,
      },
    });
    await prisma.commercialProposal.create({
      data: {
        clientId: client.id,
        calculationId: calculation.id,
        number: `${tag}-proposal`,
        snapshot: { public: true },
        validUntil: new Date(Date.now() + 3 * 86400000),
        executionTerm: "40–50 календарных дней",
        paymentTerms: "По договору",
        warranty: "12 месяцев",
        managerContact: "",
        createdById: manager.id,
        createdByName: manager.name,
      },
    });
    const order = await prisma.order.create({
      data: {
        number: `${tag}-order`,
        clientId: client.id,
        address: "TEST",
        staircase: "Прямая",
        material: "Сосна",
        amount: 500000,
        balance: 500000,
        manager: manager.name,
        managerUserId: manager.id,
      },
    });
    const task = await prisma.calendarTask.create({
      data: {
        title: `${tag}-measurement`,
        type: CalendarTaskType.MEASUREMENT,
        dueAt: new Date(Date.now() + 86400000),
        priority: CalendarTaskPriority.NORMAL,
        assigneeId: manager.id,
        creatorId: manager.id,
        clientId: client.id,
        orderId: order.id,
      },
    });
    await prisma.measurement.create({
      data: {
        clientId: client.id,
        orderId: order.id,
        calendarTaskId: task.id,
        measurer: manager.name,
        measurerUserId: manager.id,
        visitDate: task.dueAt,
      },
    });

    await assert.rejects(
      () => previewClientForceDelete(client.id, managerActor),
      (error) =>
        error instanceof ClientDeletionError && error.message === "FORBIDDEN",
    );
    const preview = await previewClientForceDelete(client.id, directorActor);
    assert.equal(preview.blocked, false);
    assert.equal(preview.impact.orders, 1);
    assert.equal(preview.impact.measurements, 1);
    assert.equal(preview.impact.calendarTasks, 1);
    assert.equal(preview.impact.proposals, 1);
    await assert.rejects(
      () =>
        forceDeleteClient(
          { clientId: client.id, confirmation: "DELETE", reason: "Cleanup" },
          directorActor,
        ),
      (error) =>
        error instanceof ClientDeletionError &&
        error.message === "CONFIRMATION_REQUIRED",
    );
    await forceDeleteClient(
      {
        clientId: client.id,
        confirmation: "УДАЛИТЬ",
        reason: "Ошибочно созданная заявка",
      },
      directorActor,
    );
    assert.equal(await prisma.client.count({ where: { id: client.id } }), 0);
    assert.equal(await prisma.order.count({ where: { id: order.id } }), 0);
    assert.equal(
      await prisma.clientDeletionAudit.count({
        where: { deletedClientId: client.id, actorId: director.id },
      }),
      1,
    );

    const blockedClient = await prisma.client.create({
      data: {
        name: `${tag}-blocked`,
        phone: `+76${String(Date.now()).slice(-9)}`,
        city: "TEST",
        manager: manager.name,
        managerUserId: manager.id,
        amount: "1000",
        status: "WON",
      },
    });
    blockedClientId = blockedClient.id;
    const blockedOrder = await prisma.order.create({
      data: {
        number: `${tag}-blocked-order`,
        clientId: blockedClient.id,
        address: "TEST",
        staircase: "Прямая",
        material: "Сосна",
        amount: 1000,
        balance: 500,
        manager: manager.name,
        managerUserId: manager.id,
      },
    });
    blockedOrderId = blockedOrder.id;
    await prisma.payment.create({
      data: {
        orderId: blockedOrder.id,
        amount: 500,
        type: "CLIENT_PAYMENT",
        method: "cash",
      },
    });
    const blockedPreview = await previewClientForceDelete(
      blockedClient.id,
      directorActor,
    );
    assert.equal(blockedPreview.blocked, true);
    assert(blockedPreview.blockers.some((item) => item.startsWith("PAYMENTS:")));
    await assert.rejects(
      () =>
        forceDeleteClient(
          {
            clientId: blockedClient.id,
            confirmation: "УДАЛИТЬ",
            reason: "Нельзя удалить оплату",
          },
          directorActor,
        ),
      (error) =>
        error instanceof ClientDeletionError &&
        error.message === "FINANCIAL_OR_OPERATIONAL_RECORDS_EXIST",
    );
    assert.equal(
      await prisma.client.count({ where: { id: blockedClient.id } }),
      1,
    );
    console.log(
      "client force-delete preview, Director RBAC, immutable audit and financial blocker checks passed",
    );
  } finally {
    if (blockedOrderId) {
      await prisma.payment.deleteMany({ where: { orderId: blockedOrderId } });
      await prisma.order.deleteMany({ where: { id: blockedOrderId } });
    }
    if (blockedClientId)
      await prisma.client.deleteMany({ where: { id: blockedClientId } });
    await prisma.clientDeletionAudit.deleteMany({
      where: { actorId: director.id },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [director.id, manager.id] } },
    });
    await prisma.$disconnect();
  }
}

void main();
