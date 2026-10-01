import "./require-test-database";
import assert from "node:assert/strict";
import { Role } from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { getFounderControl } from "@/lib/services/founder-control.service";
import { acknowledgeMandatoryTask, getMandatoryTask } from "@/lib/services/mandatory-task.service";
import { completeCoveredPaymentFollowUps, createPaymentFollowUp } from "@/lib/services/payment-follow-up.service";

async function main() {
  const tag = `payment-follow-up-${Date.now()}`;
  const manager = await prisma.user.create({ data: { companyId: 1, name: tag, email: `${tag}@test.local`, password: "test", role: Role.MANAGER } });
  const client = await prisma.client.create({ data: { companyId: 1, name: "Клиент доплаты", phone: "+77000000001", city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "2000000", status: "WON", stage: "WON" } });
  const order = await prisma.order.create({ data: { companyId: 1, number: `ORD-${tag}`, clientId: client.id, address: "Алматы", staircase: "Лестница", material: "Дуб", amount: "2000000", prepayment: "1000000", balance: "1000000", manager: manager.name, managerUserId: manager.id } });
  const actor = { userId: manager.id, name: manager.name, role: Role.MANAGER };
  try {
    const dueAt = new Date(Date.now() + 3600_000);
    const requestHash = createRequestHash({ orderId: order.id, amount: 500000, dueAt: dueAt.toISOString() });
    const task = await createPaymentFollowUp({ orderId: order.id, amount: 500000, dueAt, actor, idempotencyKey: tag, requestHash });
    const repeated = await createPaymentFollowUp({ orderId: order.id, amount: 500000, dueAt, actor, idempotencyKey: tag, requestHash });
    assert.equal(repeated.id, task.id, "idempotent retries must not duplicate a payment follow-up");
    assert.equal(await getMandatoryTask(actor), null, "a future payment promise must not block the manager early");

    const dashboard = await getDashboardSummary({ role: Role.MANAGER, userId: manager.id, period: "month" }) as { paymentFollowUps: Array<{ id: number }> };
    assert(dashboard.paymentFollowUps.some((item) => item.id === task.id), "the manager dashboard must show the active payment promise");

    await prisma.calendarTask.update({ where: { id: task.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    assert.equal((await getMandatoryTask(actor))?.phase, "ACKNOWLEDGE", "the promise must become mandatory at its due time");
    assert((await getFounderControl()).issues.some((issue) => issue.key === `payment-follow-up:${task.id}`), "an overdue promise must appear in founder control");

    await acknowledgeMandatoryTask(actor, task.id, new Date(Date.now() + 3600_000), "Свяжусь с клиентом");
    assert.equal(await getMandatoryTask(actor), null, "acknowledgement must reopen the cabinet until the manager's planned action time");
    await prisma.calendarTask.update({ where: { id: task.id }, data: { plannedCompletionAt: new Date(Date.now() - 1000) } });
    assert.equal((await getMandatoryTask(actor))?.phase, "RESULT", "the manager must submit a result at the promised action time");

    await prisma.$transaction((tx) => completeCoveredPaymentFollowUps(tx, { orderId: order.id, paymentId: 777, paymentAmount: 500000, actorId: manager.id, actorName: manager.name }));
    const completed = await prisma.calendarTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(completed.status, "COMPLETED", "a covering client payment must close the matching reminder");
    assert.equal(await getMandatoryTask(actor), null);
    console.log("payment promise scheduling, notification, founder control and automatic completion passed");
  } finally {
    const tasks = await prisma.calendarTask.findMany({ where: { orderId: order.id }, select: { id: true } });
    await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: tasks.map((task) => task.id) } } });
    await prisma.calendarTask.deleteMany({ where: { orderId: order.id } });
    await prisma.orderEvent.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.user.delete({ where: { id: manager.id } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
