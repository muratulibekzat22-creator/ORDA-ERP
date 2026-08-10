import "./require-test-database";

import assert from "node:assert/strict";
import {
  CalendarTaskStatus,
  DocumentSource,
  DocumentStatus,
  DocumentType,
  LeadLostReason,
  LeadStage,
  MeasurementClientOutcome,
  MeasurementPhotoType,
  MeasurementStatus,
  Role,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  ClientLifecycleError,
  deleteClientFromWork,
  restoreClient,
} from "@/lib/services/client-lifecycle.service";
import {
  cancelMeasurement,
  completeMeasurement,
  listMeasurements,
  MeasurementError,
  scheduleMeasurement,
  type MeasurementActor,
  type MeasurementDraft,
} from "@/lib/services/measurement.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Application lifecycle integration requires DATABASE_URL=TEST_DATABASE_URL");

const tag = `application-lifecycle-${Date.now()}`;
const userIds: number[] = [];
const clientIds: number[] = [];

const draft: MeasurementDraft = {
  stepsCount: 12,
  sameSize: true,
  stepLength: 980,
  stepWidth: 300,
  stepHeight: 40,
  riserHeight: 180,
  winderCount: 2,
  winders: [{ length: 900, width: 280, comment: "левая" }, { length: 870, width: 280, comment: "правая" }],
  platformsCount: 1,
  platforms: [{ length: 1800, width: 1000 }],
  railingLength: 5.2,
  railingComment: "по внешнему краю",
  objectNotes: "Фактические особенности объекта",
  comment: "Результат замерщика",
};

async function client(manager: { id: number; name: string }, suffix: string) {
  const created = await prisma.client.create({
    data: {
      name: `${tag}-${suffix}`,
      phone: `+7701${String(clientIds.length + 1).padStart(7, "0")}`,
      whatsapp: `+7701${String(clientIds.length + 1).padStart(7, "0")}`,
      city: "Алматы",
      address: "ул. Тестовая, 1",
      manager: manager.name,
      managerUserId: manager.id,
      amount: "0",
      stage: LeadStage.QUALIFIED,
      status: LeadStage.QUALIFIED,
    },
  });
  clientIds.push(created.id);
  return created;
}

async function addSheet(measurementId: number, uploaderId: number, suffix: string) {
  await prisma.measurementAttachment.create({
    data: {
      measurementId,
      type: MeasurementPhotoType.SHEET,
      uploadedById: uploaderId,
      fileName: `${suffix}.jpg`,
      pathname: `${tag}/${suffix}.jpg`,
      contentType: "image/jpeg",
      size: 100,
    },
  });
}

async function cleanup() {
  const measurements = await prisma.measurement.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const measurementIds = measurements.map((row) => row.id);
  const tasks = await prisma.calendarTask.findMany({ where: { OR: [{ clientId: { in: clientIds } }, { creatorId: { in: userIds } }, { assigneeId: { in: userIds } }] }, select: { id: true } });
  const taskIds = tasks.map((row) => row.id);
  const documents = await prisma.document.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const documentIds = documents.map((row) => row.id);
  const orders = await prisma.order.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const orderIds = orders.map((row) => row.id);
  if (measurementIds.length) {
    await prisma.payrollAccrual.deleteMany({ where: { measurementId: { in: measurementIds } } });
    await prisma.measurementAudit.deleteMany({ where: { measurementId: { in: measurementIds } } });
    await prisma.measurementAttachment.deleteMany({ where: { measurementId: { in: measurementIds } } });
    await prisma.measurement.deleteMany({ where: { id: { in: measurementIds } } });
  }
  if (taskIds.length) {
    await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.calendarTask.deleteMany({ where: { id: { in: taskIds } } });
  }
  if (documentIds.length) {
    await prisma.documentAudit.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.documentVersion.deleteMany({ where: { documentId: { in: documentIds } } });
    await prisma.document.deleteMany({ where: { id: { in: documentIds } } });
  }
  if (orderIds.length) {
    await prisma.companyLedgerEntry.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.financeAuditEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await prisma.orderLifecycleEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  }
  if (clientIds.length) {
    await prisma.leadConversion.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.commercialProposal.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.leadCalculation.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.leadNextAction.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.leadStatusHistory.deleteMany({ where: { clientId: { in: clientIds } } });
    await prisma.leadActivity.deleteMany({ where: { clientId: { in: clientIds } } });
  }
  if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  if (clientIds.length) {
    await prisma.clientDeletionAudit.deleteMany({ where: { deletedClientId: { in: clientIds } } });
    await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  }
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function main() {
  const director = await prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: "test", role: Role.DIRECTOR } });
  const manager = await prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "test", role: Role.MANAGER } });
  const otherManager = await prisma.user.create({ data: { name: `${tag}-other`, email: `${tag}-other@test.local`, password: "test", role: Role.MANAGER } });
  const measurer = await prisma.user.create({ data: { name: `${tag}-measurer`, email: `${tag}-measurer@test.local`, password: "test", role: Role.MEASURER } });
  userIds.push(director.id, manager.id, otherManager.id, measurer.id);
  const directorActor = { userId: director.id, role: Role.DIRECTOR, name: director.name };
  const managerActor: MeasurementActor = { userId: manager.id, role: Role.MANAGER, name: manager.name };
  const otherManagerActor: MeasurementActor = { userId: otherManager.id, role: Role.MANAGER, name: otherManager.name };
  const measurerActor: MeasurementActor = { userId: measurer.id, role: Role.MEASURER, name: measurer.name };

  try {
    const application = await client(manager, "application");
    const scheduled = await scheduleMeasurement(managerActor, { clientId: application.id, measurerUserId: measurer.id, visitDate: new Date(Date.now() + 86_400_000), city: application.city, address: application.address });
    const completed = await prisma.measurement.create({ data: { clientId: application.id, measurer: measurer.name, measurerUserId: measurer.id, visitDate: new Date(Date.now() - 86_400_000), status: MeasurementStatus.COMPLETED, completedAt: new Date(), completedSnapshot: draft, stepsCount: draft.stepsCount } });
    await addSheet(completed.id, measurer.id, "preserved-completed");
    const calculation = await prisma.leadCalculation.create({ data: { clientId: application.id, material: "Дуб", baseClientPrice: 1_000_000, clientPrice: 1_000_000, internalCost: 600_000, snapshot: { source: tag }, authorId: manager.id, authorName: manager.name } });
    const proposal = await prisma.commercialProposal.create({ data: { clientId: application.id, calculationId: calculation.id, number: `${tag}-proposal`, snapshot: { source: tag }, validUntil: new Date(Date.now() + 3 * 86_400_000), executionTerm: "30 дней", paymentTerms: "50/50", warranty: "12 месяцев", managerContact: manager.name, createdById: manager.id, createdByName: manager.name } });
    const order = await prisma.order.create({ data: { number: `${tag}-order`, clientId: application.id, address: application.address, staircase: "По замеру", material: "Дуб", amount: 1_000_000, prepayment: 200_000, balance: 800_000, manager: manager.name, managerUserId: manager.id } });
    const payment = await prisma.payment.create({ data: { orderId: order.id, amount: 200_000, type: "CLIENT_PAYMENT", method: "CASH", author: manager.name, idempotencyKey: `${tag}-payment`, requestHash: tag } });
    const document = await prisma.document.create({ data: { clientId: application.id, orderId: order.id, type: DocumentType.CONTRACT, number: `${tag}-document`, title: "Договор", documentDate: new Date(), status: DocumentStatus.READY, source: DocumentSource.GENERATED_ORDER, authorId: manager.id } });

    await assert.rejects(() => deleteClientFromWork({ ...otherManagerActor }, application.id), (error) => error instanceof ClientLifecycleError && error.message === "NOT_FOUND");
    const deleted = await deleteClientFromWork(managerActor, application.id, "Дубликат заявки");
    assert.equal(deleted.alreadyDeleted, false);
    const [deletedClient, cancelledMeasurement, cancelledTask, keptCompleted] = await Promise.all([
      prisma.client.findUniqueOrThrow({ where: { id: application.id } }),
      prisma.measurement.findUniqueOrThrow({ where: { id: scheduled.measurement.id } }),
      prisma.calendarTask.findUniqueOrThrow({ where: { id: scheduled.measurement.calendarTaskId! } }),
      prisma.measurement.findUniqueOrThrow({ where: { id: completed.id } }),
    ]);
    assert.equal(deletedClient.active, false);
    assert.ok(deletedClient.deletedAt);
    assert.equal(cancelledMeasurement.status, MeasurementStatus.CANCELLED);
    assert.equal(cancelledTask.status, CalendarTaskStatus.CANCELLED);
    assert.equal(keptCompleted.status, MeasurementStatus.COMPLETED);
    assert.ok(await prisma.commercialProposal.findUnique({ where: { id: proposal.id } }));
    assert.ok(await prisma.order.findUnique({ where: { id: order.id } }));
    assert.ok(await prisma.payment.findUnique({ where: { id: payment.id } }));
    assert.ok(await prisma.document.findUnique({ where: { id: document.id } }));
    assert.equal(await prisma.client.count({ where: { id: application.id, active: true, deletedAt: null } }), 0);
    const replay = await deleteClientFromWork(managerActor, application.id, "Повтор");
    assert.equal(replay.alreadyDeleted, true);
    assert.equal(await prisma.clientDeletionAudit.count({ where: { deletedClientId: application.id } }), 1);
    await assert.rejects(() => restoreClient(managerActor, application.id), (error) => error instanceof ClientLifecycleError && error.message === "FORBIDDEN");
    const restored = await restoreClient(directorActor, application.id);
    assert.equal(restored.alreadyRestored, false);
    assert.equal((await prisma.client.findUniqueOrThrow({ where: { id: application.id } })).active, true);

    const readyClient = await client(manager, "ready");
    const readyMeasurement = await scheduleMeasurement(managerActor, { clientId: readyClient.id, measurerUserId: measurer.id, visitDate: new Date(Date.now() + 86_400_000), address: readyClient.address });
    await addSheet(readyMeasurement.measurement.id, measurer.id, "ready");
    const ready = await completeMeasurement(measurerActor, readyMeasurement.measurement.id, draft, { clientOutcome: MeasurementClientOutcome.READY_TO_CONTINUE });
    assert.equal(ready.status, MeasurementStatus.COMPLETED);
    assert.equal(ready.clientOutcome, MeasurementClientOutcome.READY_TO_CONTINUE);
    assert.equal(await prisma.calendarTask.count({ where: { clientId: readyClient.id, assigneeId: manager.id, type: "TASK" } }), 1);
    assert.equal(await prisma.leadNextAction.count({ where: { clientId: readyClient.id, completedAt: null, nextActionComment: { contains: "клиент готов" } } }), 1);

    const returnClient = await client(manager, "return");
    const returnedMeasurement = await scheduleMeasurement(managerActor, { clientId: returnClient.id, measurerUserId: measurer.id, visitDate: new Date(Date.now() + 86_400_000), address: returnClient.address });
    await addSheet(returnedMeasurement.measurement.id, measurer.id, "return");
    await assert.rejects(() => completeMeasurement(measurerActor, returnedMeasurement.measurement.id, draft, { clientOutcome: MeasurementClientOutcome.RETURN_TO_MANAGER }), (error) => error instanceof MeasurementError && error.message === "OUTCOME_COMMENT_REQUIRED");
    const returned = await completeMeasurement(measurerActor, returnedMeasurement.measurement.id, draft, { clientOutcome: MeasurementClientOutcome.RETURN_TO_MANAGER, outcomeComment: "Уточнить срок и условия оплаты" });
    assert.equal(returned.status, MeasurementStatus.COMPLETED);
    assert.equal(await prisma.leadNextAction.count({ where: { clientId: returnClient.id, completedAt: null, nextActionComment: { contains: "Уточнить срок" } } }), 1);

    const refusedClient = await client(manager, "refused");
    const refusedMeasurement = await scheduleMeasurement(managerActor, { clientId: refusedClient.id, measurerUserId: measurer.id, visitDate: new Date(Date.now() + 86_400_000), address: refusedClient.address });
    await addSheet(refusedMeasurement.measurement.id, measurer.id, "refused");
    await assert.rejects(() => completeMeasurement(measurerActor, refusedMeasurement.measurement.id, draft, { clientOutcome: MeasurementClientOutcome.REFUSED, refusalReason: LeadLostReason.OTHER }), (error) => error instanceof MeasurementError && error.message === "REFUSAL_REASON_REQUIRED");
    const refused = await completeMeasurement(measurerActor, refusedMeasurement.measurement.id, draft, { clientOutcome: MeasurementClientOutcome.REFUSED, refusalReason: LeadLostReason.PRICE_TOO_HIGH, outcomeComment: "Клиент сравнит предложения" });
    const lost = await prisma.client.findUniqueOrThrow({ where: { id: refusedClient.id } });
    assert.equal(refused.status, MeasurementStatus.COMPLETED);
    assert.equal(lost.stage, LeadStage.LOST);
    assert.equal(lost.lostReason, LeadLostReason.PRICE_TOO_HIGH);

    const cancelClient = await client(manager, "cancel");
    const cancelScheduled = await scheduleMeasurement(managerActor, { clientId: cancelClient.id, measurerUserId: measurer.id, visitDate: new Date(Date.now() + 86_400_000), address: cancelClient.address });
    const cancelled = await cancelMeasurement(managerActor, cancelScheduled.measurement.id, { reason: "Клиент отменил выезд", comment: "Повторно не назначать" });
    assert.equal(cancelled.status, MeasurementStatus.CANCELLED);
    assert.equal((await prisma.calendarTask.findUniqueOrThrow({ where: { id: cancelScheduled.measurement.calendarTaskId! } })).status, CalendarTaskStatus.CANCELLED);
    assert.equal(await prisma.measurementAudit.count({ where: { measurementId: cancelScheduled.measurement.id, action: "MEASUREMENT_CANCELLED", comment: { contains: "Клиент отменил" } } }), 1);

    const directorMeasurements = await listMeasurements(directorActor);
    assert.equal(directorMeasurements.find((row) => row.id === ready.id)?.clientOutcome, MeasurementClientOutcome.READY_TO_CONTINUE);
    assert.equal(directorMeasurements.find((row) => row.id === returned.id)?.clientOutcome, MeasurementClientOutcome.RETURN_TO_MANAGER);
    const directorRefusal = directorMeasurements.find((row) => row.id === refused.id);
    assert.equal(directorRefusal?.status, MeasurementStatus.COMPLETED, "Client refusal must not cancel a completed measurement");
    assert.equal(directorRefusal?.refusalReason, LeadLostReason.PRICE_TOO_HIGH);
    assert.equal(directorMeasurements.find((row) => row.id === cancelled.id)?.cancellation?.reason, "Клиент отменил выезд");
    assert.equal((await listMeasurements(otherManagerActor, { clientId: refusedClient.id })).length, 0, "Another manager must not read the measurement result by ID scope");

    console.log("application soft-delete, restore, cancellation sync, structured measurement outcomes and preservation passed");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
