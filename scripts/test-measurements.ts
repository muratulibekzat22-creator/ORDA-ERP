import "./require-test-database";

import assert from "node:assert/strict";
import { MeasurementPhotoType, PayrollAccrualType, Role } from "@prisma/client";
import { parseBusinessDateTime } from "@/lib/calendar-time";
import { prisma } from "@/lib/prisma";
import { payrollSummary } from "@/lib/services/payroll.service";
import {
  completeMeasurement,
  ensureMeasurerBonusForOrder,
  handMeasurementToManager,
  inviteClientToOffice,
  listMeasurements,
  markReadyForContract,
  MeasurementError,
  saveMeasurementDraft,
  scheduleMeasurement,
  rescheduleMeasurement,
  type MeasurementActor,
  type MeasurementDraft,
} from "@/lib/services/measurement.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Measurement integration requires DATABASE_URL=TEST_DATABASE_URL");

const tag = `measurements-${Date.now()}`;
const ids = { users: [] as number[], clients: [] as number[], measurements: [] as number[], orders: [] as number[], tasks: [] as number[], profiles: [] as number[], accruals: [] as number[] };
const draft: MeasurementDraft = {
  stepsCount: 15,
  sameSize: true,
  stepLength: 1000,
  stepWidth: 300,
  riserHeight: 180,
  winderCount: 2,
  winders: [{ length: 950, width: 300, comment: "левая" }, { length: 900, width: 300, comment: "правая" }],
  platformsCount: 1,
  platforms: [{ length: 1800, width: 1000 }],
  railingLength: 5.4,
  railingComment: "по внешней стороне",
  objectNotes: "Тестовый объект",
  comment: "Фактический замер",
};

async function cleanupStaleRuns() {
  const users = await prisma.user.findMany({ where: { email: { startsWith: "measurements-", endsWith: "@test.local" } }, select: { id: true } });
  const userIds = users.map((row) => row.id);
  if (!userIds.length) return;
  const clients = await prisma.client.findMany({ where: { managerUserId: { in: userIds } }, select: { id: true } });
  const clientIds = clients.map((row) => row.id);
  const measurements = await prisma.measurement.findMany({ where: { OR: [{ clientId: { in: clientIds } }, { measurerUserId: { in: userIds } }] }, select: { id: true } });
  const measurementIds = measurements.map((row) => row.id);
  const orders = await prisma.order.findMany({ where: { clientId: { in: clientIds } }, select: { id: true } });
  const orderIds = orders.map((row) => row.id);
  const profiles = await prisma.employeePayrollProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  const profileIds = profiles.map((row) => row.id);
  const accruals = await prisma.payrollAccrual.findMany({ where: { OR: [{ measurementId: { in: measurementIds } }, { orderId: { in: orderIds } }, { employeeId: { in: profileIds } }] }, select: { id: true } });
  const accrualIds = accruals.map((row) => row.id);
  if (accrualIds.length) { await prisma.companyLedgerEntry.deleteMany({ where: { payrollAccrualId: { in: accrualIds } } }); await prisma.payrollAccrual.deleteMany({ where: { id: { in: accrualIds } } }); }
  if (profileIds.length) { await prisma.payrollAuditEvent.deleteMany({ where: { employeeId: { in: profileIds } } }); await prisma.employeeSalaryRate.deleteMany({ where: { employeeId: { in: profileIds } } }); }
  if (measurementIds.length) { await prisma.measurementAudit.deleteMany({ where: { measurementId: { in: measurementIds } } }); await prisma.measurementAttachment.deleteMany({ where: { measurementId: { in: measurementIds } } }); await prisma.measurement.deleteMany({ where: { id: { in: measurementIds } } }); }
  const tasks = await prisma.calendarTask.findMany({ where: { OR: [{ clientId: { in: clientIds } }, { creatorId: { in: userIds } }, { assigneeId: { in: userIds } }] }, select: { id: true } });
  const taskIds = tasks.map((row) => row.id);
  if (taskIds.length) { await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: taskIds } } }); await prisma.calendarTask.deleteMany({ where: { id: { in: taskIds } } }); }
  if (clientIds.length) { await prisma.leadNextAction.deleteMany({ where: { clientId: { in: clientIds } } }); await prisma.leadStatusHistory.deleteMany({ where: { clientId: { in: clientIds } } }); await prisma.leadActivity.deleteMany({ where: { clientId: { in: clientIds } } }); }
  if (orderIds.length) { await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } }); await prisma.order.deleteMany({ where: { id: { in: orderIds } } }); }
  if (profileIds.length) await prisma.employeePayrollProfile.deleteMany({ where: { id: { in: profileIds } } });
  if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function cleanup() {
  const measurementIds = ids.measurements;
  const accruals = await prisma.payrollAccrual.findMany({ where: { measurementId: { in: measurementIds } }, select: { id: true } }).catch(() => []);
  const accrualIds = accruals.map((row) => row.id);
  if (accrualIds.length) {
    await prisma.companyLedgerEntry.deleteMany({ where: { payrollAccrualId: { in: accrualIds } } });
    await prisma.payrollAccrual.deleteMany({ where: { id: { in: accrualIds } } });
  }
  if (ids.profiles.length) await prisma.payrollAuditEvent.deleteMany({ where: { employeeId: { in: ids.profiles } } });
  if (measurementIds.length) {
    await prisma.measurementAudit.deleteMany({ where: { measurementId: { in: measurementIds } } });
    await prisma.measurementAttachment.deleteMany({ where: { measurementId: { in: measurementIds } } });
    await prisma.measurement.deleteMany({ where: { id: { in: measurementIds } } });
  }
  if (ids.clients.length) {
    const tasks = await prisma.calendarTask.findMany({ where: { clientId: { in: ids.clients } }, select: { id: true } });
    const taskIds = tasks.map((row) => row.id);
    if (taskIds.length) { await prisma.calendarTaskAudit.deleteMany({ where: { taskId: { in: taskIds } } }); await prisma.calendarTask.deleteMany({ where: { id: { in: taskIds } } }); }
    await prisma.leadNextAction.deleteMany({ where: { clientId: { in: ids.clients } } });
    await prisma.leadStatusHistory.deleteMany({ where: { clientId: { in: ids.clients } } });
    await prisma.leadActivity.deleteMany({ where: { clientId: { in: ids.clients } } });
  }
  if (ids.orders.length) {
    await prisma.orderEvent.deleteMany({ where: { orderId: { in: ids.orders } } });
    await prisma.order.deleteMany({ where: { id: { in: ids.orders } } });
  }
  if (ids.profiles.length) await prisma.employeePayrollProfile.deleteMany({ where: { id: { in: ids.profiles } } });
  if (ids.clients.length) await prisma.client.deleteMany({ where: { id: { in: ids.clients } } });
  if (ids.users.length) await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
}

async function main() {
  await cleanupStaleRuns();
  console.log("measurement test: stale resources cleaned");
  const previousSettings = await prisma.systemSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {}, select: { measurerOrderBonus: true } });
  try {
    await prisma.systemSettings.update({ where: { id: 1 }, data: { measurerOrderBonus: 20_000 } });
    const manager = await prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "test", role: Role.MANAGER } });
    const otherManager = await prisma.user.create({ data: { name: `${tag}-other-manager`, email: `${tag}-other-manager@test.local`, password: "test", role: Role.MANAGER } });
    const measurerA = await prisma.user.create({ data: { name: `${tag}-a`, email: `${tag}-a@test.local`, password: "test", role: Role.MEASURER } });
    const measurerB = await prisma.user.create({ data: { name: `${tag}-b`, email: `${tag}-b@test.local`, password: "test", role: Role.MEASURER } });
    ids.users.push(manager.id, otherManager.id, measurerA.id, measurerB.id);
    console.log("measurement test: actors created");
    const managerActor: MeasurementActor = { userId: manager.id, role: Role.MANAGER, name: manager.name };
    const otherManagerActor: MeasurementActor = { userId: otherManager.id, role: Role.MANAGER, name: otherManager.name };
    const actorA: MeasurementActor = { userId: measurerA.id, role: Role.MEASURER, name: measurerA.name };
    const actorB: MeasurementActor = { userId: measurerB.id, role: Role.MEASURER, name: measurerB.name };
    const client = await prisma.client.create({ data: { name: `${tag}-client`, phone: "+77010000001", whatsapp: "+77010000001", city: "Алматы", address: "ул. Абая, 10", manager: manager.name, managerUserId: manager.id, amount: "0", status: "QUALIFIED", stage: "QUALIFIED" } });
    const noOrderClient = await prisma.client.create({ data: { name: `${tag}-no-order`, phone: "+77010000002", city: "Алматы", address: "ул. Толе би, 20", manager: manager.name, managerUserId: manager.id, amount: "0", status: "QUALIFIED", stage: "QUALIFIED" } });
    ids.clients.push(client.id, noOrderClient.id);
    const visitDate = parseBusinessDateTime("2026-08-10T14:00");
    assert.ok(visitDate);
    const scheduled = await scheduleMeasurement(managerActor, { clientId: client.id, measurerUserId: measurerA.id, visitDate, city: "Алматы", address: "ул. Абая, 10", comment: "Позвонить за час" });
    console.log("measurement test: scheduled");
    ids.measurements.push(scheduled.measurement.id);
    assert.match(scheduled.whatsappText, /10 августа 2026[\s\S]*14:00/);
    assert.match(scheduled.whatsappText, new RegExp(measurerA.name));
    assert.match(scheduled.whatsappText, new RegExp(manager.name));
    assert.match(scheduled.whatsappText, /Телефон: \+77010000001/);
    const firstTaskId = scheduled.measurement.calendarTaskId;
    assert.ok(firstTaskId);
    const rescheduledAt = parseBusinessDateTime("2026-08-10T15:00")!;
    await rescheduleMeasurement(managerActor, scheduled.measurement.id, { visitDate: rescheduledAt, measurerUserId: measurerA.id, address: "ул. Абая, 10" });
    const [syncedMeasurement, syncedTask] = await Promise.all([
      prisma.measurement.findUniqueOrThrow({ where: { id: scheduled.measurement.id } }),
      prisma.calendarTask.findUniqueOrThrow({ where: { id: firstTaskId } }),
    ]);
    assert.equal(syncedMeasurement.visitDate.toISOString(), rescheduledAt.toISOString());
    assert.equal(syncedTask.dueAt.toISOString(), rescheduledAt.toISOString());
    assert.equal(await prisma.calendarTask.count({ where: { clientId: client.id, type: "MEASUREMENT" } }), 1, "Reschedule must update the canonical task without duplicates");
    assert.equal((await listMeasurements(actorA)).some((row) => row.id === scheduled.measurement.id), true, "Measurer A sees assigned measurement");
    assert.equal((await listMeasurements(actorB)).some((row) => row.id === scheduled.measurement.id), false, "Measurer B cannot see A measurement");
    assert.equal((await listMeasurements(otherManagerActor)).some((row) => row.id === scheduled.measurement.id), false, "Another manager cannot see the lead measurement");
    await assert.rejects(() => saveMeasurementDraft(actorB, scheduled.measurement.id, draft), (error) => error instanceof MeasurementError && error.message === "NOT_FOUND");
    await prisma.measurementAttachment.create({ data: { measurementId: scheduled.measurement.id, type: MeasurementPhotoType.SHEET, uploadedById: measurerA.id, fileName: "sheet.jpg", pathname: `${tag}/sheet.jpg`, contentType: "image/jpeg", size: 1024 } });
    const completed = await completeMeasurement(actorA, scheduled.measurement.id, draft);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.stepsCount, 15);
    assert.equal(completed.stepLength, 1000);
    assert.equal(completed.stepWidth, 300);
    assert.equal(completed.riserHeight, 180);
    assert.equal(completed.winderCount, 2);
    assert.equal(completed.platformsCount, 1);
    assert.equal(completed.railingLength, 5.4);
    await assert.rejects(() => saveMeasurementDraft(actorA, scheduled.measurement.id, { ...draft, stepsCount: 16 }), (error) => error instanceof MeasurementError && error.message === "IMMUTABLE_MEASUREMENT");
    const handed = await handMeasurementToManager(actorA, scheduled.measurement.id);
    console.log("measurement test: completed and handed");
    assert.equal(handed.status, "HANDED_TO_MANAGER");
    const managerView = await listMeasurements(managerActor, { clientId: client.id });
    console.log("measurement test: manager scope verified");
    assert.equal(managerView[0]?.completedSnapshot != null, true, "Manager sees immutable result");
    assert.equal("amount" in (managerView[0] as unknown as Record<string, unknown>), false, "Measurement payload has no finance fields");
    assert.equal("bonusAccrual" in (managerView[0] as unknown as Record<string, unknown>), false, "Manager cannot see measurer payroll");
    await markReadyForContract(managerActor, scheduled.measurement.id);
    console.log("measurement test: ready-contract follow-up created");
    assert.equal(await prisma.order.count({ where: { clientId: client.id } }), 0, "Ready for contract does not create an order");
    await inviteClientToOffice(managerActor, scheduled.measurement.id, parseBusinessDateTime("2026-08-11T11:00")!, "Взять образцы");
    console.log("measurement test: office invitation created");

    const order = await prisma.order.create({ data: { number: `${tag}-order`, clientId: client.id, address: client.address, staircase: "По замеру", material: "Дуб", amount: 1_000_000, balance: 1_000_000, manager: manager.name, managerUserId: manager.id, status: "Оформлен" } });
    ids.orders.push(order.id);
    console.log("measurement test: real order created");
    const firstBonus = await prisma.$transaction((tx) => ensureMeasurerBonusForOrder(tx, order.id, managerActor));
    const replayBonus = await prisma.$transaction((tx) => ensureMeasurerBonusForOrder(tx, order.id, managerActor));
    console.log("measurement test: bonus linked and replayed");
    assert.equal(firstBonus.created, true);
    assert.equal(replayBonus.created, false);
    const bonuses = await prisma.payrollAccrual.findMany({ where: { orderId: order.id, type: PayrollAccrualType.MEASUREMENT_BONUS } });
    assert.equal(bonuses.length, 1, "Exactly one measurement bonus per real order");
    assert.equal(Number(bonuses[0].amount), 20_000, "Bonus uses director setting");
    ids.accruals.push(bonuses[0].id);

    const noOrder = await scheduleMeasurement(managerActor, { clientId: noOrderClient.id, measurerUserId: measurerA.id, visitDate: parseBusinessDateTime("2026-08-12T10:00")!, address: noOrderClient.address });
    console.log("measurement test: no-order measurement scheduled");
    ids.measurements.push(noOrder.measurement.id);
    await prisma.measurementAttachment.create({ data: { measurementId: noOrder.measurement.id, type: MeasurementPhotoType.SHEET, uploadedById: measurerA.id, fileName: "sheet-2.jpg", pathname: `${tag}/sheet-2.jpg`, contentType: "image/jpeg", size: 1024 } });
    await completeMeasurement(actorA, noOrder.measurement.id, draft);
    await handMeasurementToManager(actorA, noOrder.measurement.id);
    console.log("measurement test: no-order path completed");
    assert.equal(await prisma.payrollAccrual.count({ where: { measurementId: noOrder.measurement.id } }), 0, "No Order means no bonus");

    const profileA = await prisma.employeePayrollProfile.findUniqueOrThrow({ where: { userId: measurerA.id } });
    const profileB = await prisma.employeePayrollProfile.create({ data: { userId: measurerB.id, hiredAt: new Date(), baseSalary: 0, defaultGuaranteedBonus: 0 } });
    ids.profiles.push(profileA.id, profileB.id);
    const period = await prisma.payrollPeriod.findFirstOrThrow({ where: { accruals: { some: { id: bonuses[0].id } } } });
    const self = await payrollSummary(period.id, actorA, profileB.id);
    console.log("measurement test: self payroll scope verified");
    assert.deepEqual(self.rows.map((row) => row.userId), [measurerA.id], "Self payroll ignores spoofed employeeId");
    assert.equal(self.rows[0].accruals.some((row) => row.type === PayrollAccrualType.MEASUREMENT_BONUS), true);

    const auditActions = await prisma.measurementAudit.findMany({ where: { measurementId: scheduled.measurement.id }, select: { action: true } });
    for (const action of ["SCHEDULED", "COMPLETED", "HANDED_TO_MANAGER", "READY_FOR_CONTRACT", "OFFICE_INVITATION", "BONUS_ACCRUED"]) assert.ok(auditActions.some((row) => row.action === action), `missing audit ${action}`);
    console.log("measurement workspace workflow, RBAC, immutable snapshot, follow-ups and exactly-once payroll bonus passed");
  } finally {
    await cleanup();
    await prisma.systemSettings.update({ where: { id: 1 }, data: { measurerOrderBonus: previousSettings.measurerOrderBonus } });
    await prisma.$disconnect();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
