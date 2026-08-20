import "./require-test-database";

import assert from "node:assert/strict";
import { CalendarTaskStatus, CalendarTaskType, MeasurementStatus, OrderBlockerSeverity, OrderLifecycle, Role } from "@prisma/client";
import { prisma } from "../lib/prisma";
import {
  assignInstallation,
  completeInstallation,
  completeControlMeasurement,
  confirmMilestone,
  evaluateGate,
  openBlocker,
  orderAttention,
  orderFinance,
  orderMaterials,
  orderOverview,
  Order360Error,
  orderTimeline,
  resolveBlocker,
  transitionLifecycle,
} from "../lib/services/order360.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Order 360 integration requires TEST_DATABASE_URL");
const tag = `order360-${Date.now()}`;
const key = (value: string) => `${tag}:${value}`;
const hash = (value: string) => `hash:${value}`;
async function code(run: () => Promise<unknown>, expected: string) {
  await assert.rejects(run, (error) => error instanceof Order360Error && error.message === expected);
}

async function main() {
  const userIds: number[] = [], orderIds: number[] = [], clientIds: number[] = [], partnerIds: number[] = [];
  try {
    const [director, manager, production, installer, partnerUser, otherManager, measurer] = await Promise.all([
      prisma.user.create({ data: { name: `${tag}-director`, email: `${tag}-director@test.local`, password: "test", role: Role.DIRECTOR } }),
      prisma.user.create({ data: { name: `${tag}-manager`, email: `${tag}-manager@test.local`, password: "test", role: Role.MANAGER } }),
      prisma.user.create({ data: { name: `${tag}-production`, email: `${tag}-production@test.local`, password: "test", role: Role.PRODUCTION } }),
      prisma.user.create({ data: { name: `${tag}-installer`, email: `${tag}-installer@test.local`, password: "test", role: Role.INSTALLER } }),
      prisma.user.create({ data: { name: `${tag}-partner`, email: `${tag}-partner@test.local`, password: "test", role: Role.PARTNER } }),
      prisma.user.create({ data: { name: `${tag}-other`, email: `${tag}-other@test.local`, password: "test", role: Role.MANAGER } }),
      prisma.user.create({ data: { name: `${tag}-measurer`, email: `${tag}-measurer@test.local`, password: "test", role: Role.MEASURER } }),
    ]);
    userIds.push(director.id, manager.id, production.id, installer.id, partnerUser.id, otherManager.id, measurer.id);
    const partner = await prisma.partner.create({ data: { name: tag, phone: "77000000000", city: "Test", userId: partnerUser.id } });
    partnerIds.push(partner.id);
    const client = await prisma.client.create({ data: { name: tag, phone: "77000000001", city: "Test", manager: manager.name, managerUserId: manager.id, amount: "1000", status: "WON", stage: "WON" } });
    clientIds.push(client.id);
    const order = await prisma.order.create({ data: { number: `O360-${Date.now()}`, clientId: client.id, partnerId: partner.id, address: "Test address", staircase: "Straight", material: "Oak", amount: 1000, prepayment: 50, balance: 950, partnerPrice: 400, partnerPaid: 100, partnerBalance: 300, companyProfit: 600, manager: manager.name, managerUserId: manager.id, requiredPrepayment: 50 } });
    orderIds.push(order.id);
    await prisma.production.create({ data: { orderId: order.id, stage: "CUTTING", percent: 0, master: production.name, masterUserId: production.id } });
    const actors = {
      director: { userId: director.id, role: Role.DIRECTOR, name: director.name },
      manager: { userId: manager.id, role: Role.MANAGER, name: manager.name },
      production: { userId: production.id, role: Role.PRODUCTION, name: production.name },
      installer: { userId: installer.id, role: Role.INSTALLER, name: installer.name },
      partner: { userId: partnerUser.id, role: Role.PARTNER, name: partnerUser.name },
      other: { userId: otherManager.id, role: Role.MANAGER, name: otherManager.name },
      measurer: { userId: measurer.id, role: Role.MEASURER, name: measurer.name },
    };
    const measurementOrder = await prisma.order.create({ data: { number: `O360-MEASURE-${Date.now()}`, clientId: client.id, address: "Measurement", staircase: "Straight", material: "Oak", amount: 5200000, balance: 5200000, manager: manager.name, managerUserId: manager.id } });
    orderIds.push(measurementOrder.id);
    const calendarTask = await prisma.calendarTask.create({ data: { title: "Контрольный замер", type: CalendarTaskType.MEASUREMENT, dueAt: new Date(), assigneeId: measurer.id, creatorId: manager.id, clientId: client.id, orderId: measurementOrder.id } });
    await prisma.measurement.create({ data: { orderId: measurementOrder.id, clientId: client.id, calendarTaskId: calendarTask.id, measurer: measurer.name, measurerUserId: measurer.id, visitDate: new Date(), status: MeasurementStatus.ASSIGNED, city: "Караганда", address: "Measurement" } });
    await code(() => completeControlMeasurement({ orderId: measurementOrder.id, expectedVersion: 1, completedAt: new Date("2026-08-19T12:00:00Z"), key: key("foreign-control-measurement"), requestHash: hash("foreign-control-measurement") }, actors.other), "NOT_FOUND");
    const measured = await completeControlMeasurement({ orderId: measurementOrder.id, expectedVersion: 1, completedAt: new Date("2026-08-19T12:00:00Z"), comment: "Размеры подтверждены", key: key("control-measurement"), requestHash: hash("control-measurement") }, actors.measurer);
    assert.equal(measured.created, true, "control measurement action created");
    const measuredOrder = await prisma.order.findUniqueOrThrow({ where: { id: measurementOrder.id } });
    assert.equal(measuredOrder.lifecycle, OrderLifecycle.READY_FOR_PRODUCTION, "control measurement did not move order to preparation");
    assert.equal((await prisma.calendarTask.findUniqueOrThrow({ where: { id: calendarTask.id } })).status, CalendarTaskStatus.COMPLETED, "measurement calendar task not completed");
    assert.equal((await prisma.production.findFirstOrThrow({ where: { orderId: measurementOrder.id } })).stage, "Подготовка", "production task not created");
    assert.equal(await prisma.orderBlocker.count({ where: { orderId: measurementOrder.id, status: "OPEN" } }), 2, "missing partner/cost tasks not created");
    assert.equal(await prisma.calendarTask.count({ where: { orderId: measurementOrder.id, type: CalendarTaskType.TASK, assigneeId: manager.id } }), 1, "next manager calendar task not created");
    assert.equal(await prisma.measurementAudit.count({ where: { measurement: { orderId: measurementOrder.id }, action: "COMPLETED_FROM_ORDER" } }), 1, "measurement audit not created");
    assert.equal(await prisma.orderEvent.count({ where: { orderId: measurementOrder.id, title: "Замер снят" } }), 1, "timeline event not created");
    const measuredReplay = await completeControlMeasurement({ orderId: measurementOrder.id, expectedVersion: 1, completedAt: new Date("2026-08-19T12:00:00Z"), comment: "Размеры подтверждены", key: key("control-measurement"), requestHash: hash("control-measurement") }, actors.measurer);
    assert.equal(measuredReplay.created, false, "control measurement idempotency replay");
    assert.equal(await prisma.orderEvent.count({ where: { orderId: measurementOrder.id, title: "Замер снят" } }), 1, "duplicate timeline event created");
    assert.equal((await evaluateGate(order.id, OrderLifecycle.READY_FOR_PRODUCTION)).passed, false, "empty production gate passed");
    await code(() => orderOverview(order.id, actors.other), "NOT_FOUND");
    const managerOverview = await orderOverview(order.id, actors.manager);
    assert("commerce" in managerOverview && !("finance" in managerOverview));
    assert(!JSON.stringify(managerOverview).includes("companyProfit"));
    const partnerOverview = await orderOverview(order.id, actors.partner);
    assert("workshop" in partnerOverview && !("commerce" in partnerOverview));
    assert(!JSON.stringify(partnerOverview).includes("clientPrice"));
    await code(() => orderFinance(order.id, actors.production), "FORBIDDEN");
    assert.deepEqual(await orderMaterials(order.id, actors.manager), []);
    let version = 1;
    for (const [action, value] of [
      ["confirm-contract", undefined], ["complete-measurement", undefined], ["approve-drawing", undefined],
      ["confirm-specification", undefined], ["confirm-workshop", undefined], ["set-production-deadline", "2026-09-01"],
      ["confirm-materials", undefined],
    ] as const) {
      const result = await confirmMilestone({ orderId: order.id, action, value, expectedVersion: version, key: key(action), requestHash: hash(action) }, actors.manager);
      version = Number(result.version);
    }
    assert.equal((await evaluateGate(order.id, OrderLifecycle.READY_FOR_PRODUCTION)).passed, true);
    const preparation = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.PREPARATION, expectedVersion: version, key: key("preparation"), requestHash: hash("preparation") }, actors.manager);
    version = Number(preparation.version);
    const blockerResult = await openBlocker({ orderId: order.id, type: "MATERIAL", severity: OrderBlockerSeverity.CRITICAL, title: "Critical test", key: key("blocker"), requestHash: hash("blocker") }, actors.manager);
    await code(() => transitionLifecycle({ orderId: order.id, to: OrderLifecycle.READY_FOR_PRODUCTION, expectedVersion: version, key: key("blocked-transition"), requestHash: hash("blocked-transition") }, actors.manager), "GATE_FAILED");
    await resolveBlocker({ blockerId: blockerResult.blocker.id, resolution: "Resolved", key: key("resolve"), requestHash: hash("resolve") }, actors.manager);
    const readyProduction = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.READY_FOR_PRODUCTION, expectedVersion: version, key: key("ready-production"), requestHash: hash("ready-production") }, actors.manager);
    version = Number(readyProduction.version);
    const started = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.IN_PRODUCTION, expectedVersion: version, key: key("production-start"), requestHash: hash("production-start") }, actors.production);
    version = Number(started.version);
    const technicalStage = (await prisma.production.findFirstOrThrow({ where: { orderId: order.id } })).stage;
    assert.equal(technicalStage, "CUTTING", "Order lifecycle overwrote Production.stage");
    await prisma.production.updateMany({ where: { orderId: order.id }, data: { percent: 100, completedAt: new Date() } });
    const completeness = await confirmMilestone({ orderId: order.id, action: "confirm-completeness", expectedVersion: version, key: key("complete-set"), requestHash: hash("complete-set") }, actors.manager);
    version = Number(completeness.version);
    const readyInstall = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.READY_FOR_INSTALLATION, expectedVersion: version, key: key("ready-install"), requestHash: hash("ready-install") }, actors.production);
    version = Number(readyInstall.version);
    const assignment = await assignInstallation({ orderId: order.id, scheduledAt: new Date("2026-09-05"), installerUserId: installer.id, packageConfirmed: true, expectedVersion: version, key: key("assign-install"), requestHash: hash("assign-install") }, actors.manager);
    version = Number(assignment.version);
    const installation = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.INSTALLATION, expectedVersion: version, key: key("installation"), requestHash: hash("installation") }, actors.installer);
    version = Number(installation.version);
    const installed = await completeInstallation(order.id, version, key("installed"), hash("installed"), actors.installer);
    version = Number(installed.version);
    const acceptance = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.ACCEPTANCE, expectedVersion: version, key: key("acceptance"), requestHash: hash("acceptance") }, actors.installer);
    version = Number(acceptance.version);
    const accepted = await confirmMilestone({ orderId: order.id, action: "record-acceptance", expectedVersion: version, key: key("accepted"), requestHash: hash("accepted") }, actors.manager);
    version = Number(accepted.version);
    const completed = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.COMPLETED, expectedVersion: version, key: key("completed"), requestHash: hash("completed") }, actors.manager);
    assert.equal(Number(completed.version), version + 1);
    const completedOrder = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    assert.equal(completedOrder.lifecycle, OrderLifecycle.COMPLETED);
    assert(Number(completedOrder.balance) > 0, "financial debt was erased by operational completion");
    assert.equal((await prisma.production.findFirstOrThrow({ where: { orderId: order.id } })).stage, "CUTTING");
    const timeline = await orderTimeline(order.id, actors.manager, 1, 5);
    assert(timeline.events.length <= 5 && timeline.events.length > 0, "timeline pagination");
    assert((await orderAttention(order.id, actors.manager)).some((signal) => signal.type === "DRAWING_MISSING") === false);
    const replay = await transitionLifecycle({ orderId: order.id, to: OrderLifecycle.COMPLETED, expectedVersion: version, key: key("completed"), requestHash: hash("completed") }, actors.manager);
    assert.equal(replay.created, false, "transition idempotency");

    const overrideOrder = await prisma.order.create({ data: { number: `O360-OVR-${Date.now()}`, clientId: client.id, address: "Override", staircase: "Straight", material: "Oak", amount: 1, manager: manager.name, managerUserId: manager.id } });
    orderIds.push(overrideOrder.id);
    await transitionLifecycle({ orderId: overrideOrder.id, to: OrderLifecycle.PREPARATION, expectedVersion: 1, key: key("override-prep"), requestHash: hash("override-prep") }, actors.director);
    const overridden = await transitionLifecycle({ orderId: overrideOrder.id, to: OrderLifecycle.READY_FOR_PRODUCTION, expectedVersion: 2, override: true, reason: "Director accepted documented risk", key: key("override-ready"), requestHash: hash("override-ready") }, actors.director);
    assert.equal(overridden.created, true);
    assert.equal(await prisma.orderGateOverride.count({ where: { orderId: overrideOrder.id } }), 1);
    await code(() => transitionLifecycle({ orderId: overrideOrder.id, to: OrderLifecycle.PREPARATION, expectedVersion: 3, key: key("back-without-reason"), requestHash: hash("back-without-reason") }, actors.director), "REASON_REQUIRED");
    const returned = await transitionLifecycle({ orderId: overrideOrder.id, to: OrderLifecycle.PREPARATION, expectedVersion: 3, reason: "Возврат на уточнение", key: key("back-with-reason"), requestHash: hash("back-with-reason") }, actors.director);
    assert.equal(returned.created, true, "director backward transition with reason");

    const raceOrder = await prisma.order.create({ data: { number: `O360-RACE-${Date.now()}`, clientId: client.id, address: "Race", staircase: "Straight", material: "Oak", amount: 1, manager: manager.name, managerUserId: manager.id, lifecycle: OrderLifecycle.PREPARATION, version: 2 } });
    orderIds.push(raceOrder.id);
    const race = await Promise.allSettled(["a", "b"].map((suffix) => transitionLifecycle({ orderId: raceOrder.id, to: OrderLifecycle.READY_FOR_PRODUCTION, expectedVersion: 2, override: true, reason: "Concurrent director override", key: key(`race-${suffix}`), requestHash: hash(`race-${suffix}`) }, actors.director)));
    assert.equal(race.filter((x) => x.status === "fulfilled").length, 1, "concurrent transition committed more than once");
    assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: raceOrder.id } })).version, 3);
    console.log("Order 360 lifecycle, gates, blockers, RBAC, timeline and concurrency checks passed");
  } finally {
    if (orderIds.length) {
      await prisma.calendarTaskAudit.deleteMany({ where: { task: { orderId: { in: orderIds } } } });
      await prisma.measurementAudit.deleteMany({ where: { measurement: { orderId: { in: orderIds } } } });
      await prisma.measurement.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.calendarTask.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderGateOverride.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderLifecycleEvent.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderBlocker.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderInstallation.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.productionStageHistory.deleteMany({ where: { production: { orderId: { in: orderIds } } } });
      await prisma.production.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (clientIds.length) await prisma.client.deleteMany({ where: { id: { in: clientIds } } });
    if (partnerIds.length) await prisma.partner.deleteMany({ where: { id: { in: partnerIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  }
}
void main();
