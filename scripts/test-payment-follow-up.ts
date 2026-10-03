import "./require-test-database";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";

import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { getDashboardSummary } from "@/lib/services/dashboard.service";
import { getFounderControl } from "@/lib/services/founder-control.service";
import { acknowledgeMandatoryTask, getMandatoryTask, submitMandatoryTaskResult } from "@/lib/services/mandatory-task.service";
import { createOrder } from "@/lib/services/order.service";
import { cancelPaymentFollowUp, createPaymentFollowUp, listPaymentFollowUps } from "@/lib/services/payment-follow-up.service";

async function main() {
  const tag = `payment-follow-up-${Date.now()}`;
  const director = await prisma.user.create({ data: { companyId: 1, name: `${tag}-director`, email: `${tag}-director@test.local`, password: "test", role: Role.DIRECTOR } });
  const operationsDirector = await prisma.user.create({ data: { companyId: 1, name: `${tag}-operations`, email: `${tag}-operations@test.local`, password: "test", role: Role.OPERATIONS_DIRECTOR } });
  const manager = await prisma.user.create({ data: { companyId: 1, name: tag, email: `${tag}@test.local`, password: "test", role: Role.MANAGER } });
  const otherManager = await prisma.user.create({ data: { companyId: 1, name: `${tag}-other`, email: `${tag}-other@test.local`, password: "test", role: Role.MANAGER } });
  const client = await prisma.client.create({ data: { companyId: 1, name: "Клиент доплаты", phone: "+77000000001", city: "Алматы", manager: manager.name, managerUserId: manager.id, amount: "2000000", status: "WON", stage: "WON" } });
  const order = await prisma.order.create({ data: { companyId: 1, number: `ORD-${tag}`, clientId: client.id, address: "Алматы", staircase: "Лестница", material: "Дуб", amount: "2000000", prepayment: "1000000", balance: "1000000", manager: manager.name, managerUserId: manager.id } });
  const actor = { userId: manager.id, name: manager.name, role: Role.MANAGER };
  let replayOrderId: number | null = null;
  try {
    const dueAt = new Date(Date.now() + 3600_000);
    const requestHash = createRequestHash({ orderId: order.id, amount: 500000, dueAt: dueAt.toISOString() });
    const task = await createPaymentFollowUp({ orderId: order.id, amount: 500000, dueAt, actor, idempotencyKey: tag, requestHash });
    const repeated = await createPaymentFollowUp({ orderId: order.id, amount: 500000, dueAt, actor, idempotencyKey: tag, requestHash });
    assert.equal(repeated.id, task.id, "idempotent retries must not duplicate a payment follow-up");
    await assert.rejects(createPaymentFollowUp({ orderId: order.id, amount: 500000, dueAt, actor: { userId: otherManager.id, name: otherManager.name, role: Role.MANAGER }, idempotencyKey: tag, requestHash }), /ORDER_NOT_FOUND/, "idempotent replay must enforce order ownership before returning data");
    await assert.rejects(
      createPaymentFollowUp({ orderId: order.id, amount: 100000, dueAt: new Date(Date.now() - 1000), actor, idempotencyKey: `${tag}-past`, requestHash: "past" }),
      /INVALID_PAYMENT_FOLLOW_UP_DATE/,
      "past promises must be rejected",
    );
    await assert.rejects(
      listPaymentFollowUps(order.id, { userId: otherManager.id, name: otherManager.name, role: Role.MANAGER }),
      /ORDER_NOT_FOUND/,
      "a manager must not see another manager's promises",
    );
    assert((await listPaymentFollowUps(order.id, { userId: director.id, name: director.name, role: Role.DIRECTOR })).some((item) => item.id === task.id));
    assert((await listPaymentFollowUps(order.id, { userId: operationsDirector.id, name: operationsDirector.name, role: Role.OPERATIONS_DIRECTOR })).some((item) => item.id === task.id));
    assert.equal(await getMandatoryTask(actor), null, "a future payment promise must not block the manager early");

    const dashboard = await getDashboardSummary({ role: Role.MANAGER, userId: manager.id, period: "month" }) as { paymentFollowUps: Array<{ id: number }> };
    assert(dashboard.paymentFollowUps.some((item) => item.id === task.id), "the manager dashboard must show the active payment promise");

    await prisma.calendarTask.update({ where: { id: task.id }, data: { dueAt: new Date(Date.now() - 3600_000) } });
    const delayedRetry = await createPaymentFollowUp({ orderId: order.id, amount: 500000, dueAt, actor, idempotencyKey: tag, requestHash, now: new Date(dueAt.getTime() + 3600_000) });
    assert.equal(delayedRetry.id, task.id, "a delayed idempotent retry must return the existing task after its deadline");
    assert.equal((await getMandatoryTask(actor))?.phase, "ACKNOWLEDGE", "the promise must become mandatory at its due time");
    assert((await getFounderControl()).issues.some((issue) => issue.key === `payment-follow-up:${task.id}`), "an overdue promise must appear in founder control");

    await assert.rejects(acknowledgeMandatoryTask(actor, task.id, new Date(Date.now() + 25 * 3600_000), "Слишком поздно"), /PAYMENT_FOLLOW_UP_COMPLETION_TOO_LATE/, "payment contact cannot be postponed for more than 24 hours");
    await acknowledgeMandatoryTask(actor, task.id, new Date(Date.now() + 3600_000), "Свяжусь с клиентом");
    assert.equal(await getMandatoryTask(actor), null, "acknowledgement must reopen the cabinet until the manager's planned action time");
    await prisma.calendarTask.update({ where: { id: task.id }, data: { plannedCompletionAt: new Date(Date.now() - 1000) } });
    assert.equal((await getMandatoryTask(actor))?.phase, "RESULT", "the manager must submit a result at the promised action time");

    await submitMandatoryTaskResult(actor, task.id, "Связался с клиентом; оплата зарегистрирована отдельно в заказе");
    const completed = await prisma.calendarTask.findUniqueOrThrow({ where: { id: task.id } });
    assert.equal(completed.status, "COMPLETED", "only the manager's recorded result closes the reminder");
    assert.equal(await getMandatoryTask(actor), null);

    const futureCancellation = await createPaymentFollowUp({ orderId: order.id, amount: 100000, dueAt: new Date(Date.now() + 3600_000), actor, idempotencyKey: `${tag}-cancel-future`, requestHash: "cancel-future" });
    await assert.rejects(cancelPaymentFollowUp({ orderId: order.id, taskId: futureCancellation.id, reason: "", actor }), /PAYMENT_FOLLOW_UP_CANCEL_REASON_REQUIRED/);
    assert.equal((await cancelPaymentFollowUp({ orderId: order.id, taskId: futureCancellation.id, reason: "Клиент оплатил раньше", actor })).status, "CANCELLED", "manager may cancel a future promise with a reason");

    const overdueCancellation = await createPaymentFollowUp({ orderId: order.id, amount: 120000, dueAt: new Date(Date.now() + 3600_000), actor, idempotencyKey: `${tag}-cancel-overdue`, requestHash: "cancel-overdue" });
    await prisma.calendarTask.update({ where: { id: overdueCancellation.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    await assert.rejects(cancelPaymentFollowUp({ orderId: order.id, taskId: overdueCancellation.id, reason: "Клиент отказался", actor }), /PAYMENT_FOLLOW_UP_DIRECTOR_REQUIRED/);
    assert.equal((await cancelPaymentFollowUp({ orderId: order.id, taskId: overdueCancellation.id, reason: "Отмена подтверждена директором", actor: { userId: director.id, name: director.name, role: Role.DIRECTOR } })).status, "CANCELLED", "director may cancel an overdue promise with a reason");

    const parallelDueAt = new Date(Date.now() + 3600_000);
    const parallelInput = { orderId: order.id, amount: 50000, dueAt: parallelDueAt, actor, idempotencyKey: `${tag}-parallel`, requestHash: "parallel" };
    const parallel = await Promise.all([createPaymentFollowUp(parallelInput), createPaymentFollowUp(parallelInput)]);
    assert.equal(parallel[0].id, parallel[1].id, "concurrent idempotent requests must return one task");
    await cancelPaymentFollowUp({ orderId: order.id, taskId: parallel[0].id, reason: "Проверка конкурентного повтора", actor });

    const reserved = await createPaymentFollowUp({ orderId: order.id, amount: 800000, dueAt: new Date(Date.now() + 3600_000), actor, idempotencyKey: `${tag}-reserved`, requestHash: "reserved" });
    await assert.rejects(createPaymentFollowUp({ orderId: order.id, amount: 300000, dueAt: new Date(Date.now() + 7200_000), actor, idempotencyKey: `${tag}-over-reserved`, requestHash: "over-reserved" }), /PAYMENT_FOLLOW_UPS_EXCEED_BALANCE/, "active promises may not exceed the client balance together");
    await cancelPaymentFollowUp({ orderId: order.id, taskId: reserved.id, reason: "План оплаты изменён", actor });
    const released = await createPaymentFollowUp({ orderId: order.id, amount: 300000, dueAt: new Date(Date.now() + 7200_000), actor, idempotencyKey: `${tag}-released`, requestHash: "released" });
    assert.equal(released.expectedAmount?.toString(), "300000", "a cancelled promise must release the reserved balance");

    const orderPromiseAt = new Date(Date.now() + 3600_000);
    const orderInput = {
      clientId: client.id,
      partnerId: null,
      address: "Алматы",
      staircase: "Лестница",
      material: "Дуб",
      amount: 600000,
      prepayment: 0,
      partnerPrice: 0,
      partnerPaid: 0,
      manager: manager.name,
      managerUserId: manager.id,
      actorUserId: manager.id,
      actorRole: Role.MANAGER,
      paymentPromiseAmount: 200000,
      paymentPromiseAt: orderPromiseAt,
      idempotencyKey: `${tag}-order-replay`,
      requestHash: "order-replay",
    };
    const createdOrder = await createOrder(orderInput);
    replayOrderId = createdOrder.order.id;
    const repeatedOrder = await createOrder({ ...orderInput, validationNow: new Date(orderPromiseAt.getTime() + 3600_000) });
    assert.equal(repeatedOrder.order.id, createdOrder.order.id, "delayed order replay must return the existing order after the promised-payment deadline");
    assert.equal(repeatedOrder.created, false);

    const paymentService = readFileSync("lib/services/payment.service.ts", "utf8");
    assert.doesNotMatch(paymentService, /completeCoveredPaymentFollowUps|AUTO_COMPLETED_BY_PAYMENT/, "financial postings must not guess which promise to close");
    const orderService = readFileSync("lib/services/order.service.ts", "utf8");
    assert(orderService.indexOf("if (existingEvent)") < orderService.indexOf("assertPaymentFollowUpInput(data.paymentPromiseAmount"), "order idempotency replay must be resolved before future-date validation");
    console.log("payment promise scheduling, future-date validation, authorization, founder control and mandatory result passed");
  } finally {
    if (replayOrderId) {
      const replayTasks = await prisma.calendarTask.findMany({ where: { orderId: replayOrderId }, select: { id: true } });
      await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: replayTasks.map((task) => task.id) } } });
      await prisma.calendarTask.deleteMany({ where: { orderId: replayOrderId } });
      await prisma.orderEvent.deleteMany({ where: { orderId: replayOrderId } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: replayOrderId } });
      await prisma.orderLifecycleEvent.deleteMany({ where: { orderId: replayOrderId } });
      await prisma.order.delete({ where: { id: replayOrderId } });
    }
    const tasks = await prisma.calendarTask.findMany({ where: { orderId: order.id }, select: { id: true } });
    await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: tasks.map((task) => task.id) } } });
    await prisma.calendarTask.deleteMany({ where: { orderId: order.id } });
    await prisma.orderEvent.deleteMany({ where: { orderId: order.id } });
    await prisma.order.delete({ where: { id: order.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.user.deleteMany({ where: { id: { in: [director.id, operationsDirector.id, manager.id, otherManager.id] } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
