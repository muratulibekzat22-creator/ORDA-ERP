import {
  OrderBlockerSeverity,
  OrderBlockerStatus,
  OrderLifecycle,
  Prisma,
  Role,
} from "@prisma/client";
import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { reverseMeasurerBonusForCancelledOrder } from "@/lib/services/measurement.service";

export type Order360Actor = { userId: number; role: Role; name: string };
export class Order360Error extends Error {}

export const LIFECYCLE: OrderLifecycle[] = [
  OrderLifecycle.CREATED,
  OrderLifecycle.PREPARATION,
  OrderLifecycle.READY_FOR_PRODUCTION,
  OrderLifecycle.IN_PRODUCTION,
  OrderLifecycle.READY_FOR_INSTALLATION,
  OrderLifecycle.INSTALLATION,
  OrderLifecycle.ACCEPTANCE,
  OrderLifecycle.COMPLETED,
];

export async function canAccessOrder360(orderId: number, actor: Order360Actor) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      managerUserId: true,
      manager: true,
      partnerId: true,
      leadConversion: { select: { managerId: true } },
      productions: { select: { masterUserId: true } },
      measurements: { select: { measurerUserId: true } },
      installation: { select: { installerUserId: true } },
    },
  });
  if (!order) return false;
  if (actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT) return true;
  if (actor.role === Role.MANAGER)
    return order.managerUserId === actor.userId || order.leadConversion?.managerId === actor.userId || (!order.managerUserId && order.manager === actor.name);
  if (actor.role === Role.PARTNER) {
    const partner = await prisma.partner.findUnique({ where: { userId: actor.userId }, select: { id: true } });
    return !!partner && order.partnerId === partner.id;
  }
  if (actor.role === Role.PRODUCTION) return order.productions.some((row) => row.masterUserId === actor.userId);
  if (actor.role === Role.INSTALLER) return order.installation?.installerUserId === actor.userId || order.productions.some((row) => row.masterUserId === actor.userId);
  if (actor.role === Role.MEASURER) return order.measurements.some((row) => row.measurerUserId === actor.userId);
  return false;
}

async function assertAccess(orderId: number, actor: Order360Actor) {
  if (!(await canAccessOrder360(orderId, actor))) throw new Order360Error("NOT_FOUND");
}

type GateItem = { code: string; passed: boolean; message: string };
export async function evaluateGate(orderId: number, target: OrderLifecycle) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      documents: { select: { type: true } },
      measurements: { select: { id: true } },
      productions: { select: { percent: true, completedAt: true, actualEndAt: true } },
      blockers: { where: { status: OrderBlockerStatus.OPEN, severity: OrderBlockerSeverity.CRITICAL }, select: { id: true } },
      installation: true,
    },
  });
  if (!order) throw new Order360Error("NOT_FOUND");
  const noCritical: GateItem = { code: "NO_CRITICAL_BLOCKERS", passed: order.blockers.length === 0, message: "Есть критический блокер" };
  let checks: GateItem[] = [noCritical];
  if (target === OrderLifecycle.READY_FOR_PRODUCTION) checks = [
    { code: "CONTRACT", passed: !!order.contractConfirmedAt || order.documents.some((d) => d.type === "CONTRACT"), message: "Договор не подтверждён" },
    { code: "PREPAYMENT", passed: Number(order.prepayment) >= Number(order.requiredPrepayment), message: "Требуемая предоплата не получена" },
    { code: "MEASUREMENT", passed: !!order.controlMeasurementCompletedAt || order.measurements.length > 0, message: "Контрольный замер не завершён" },
    { code: "DRAWING", passed: !!order.drawingApprovedAt, message: "Чертёж не согласован" },
    { code: "SPECIFICATION", passed: !!order.specificationDefinedAt, message: "Спецификация не определена" },
    { code: "WORKSHOP", passed: !!order.partnerId && !!order.workshopConfirmedAt, message: "ЦЕХ не назначен или не подтвердил" },
    { code: "DEADLINE", passed: !!order.productionDeadline, message: "Срок производства не установлен" },
    { code: "MATERIALS", passed: !!order.materialsReadyAt, message: "Материалы не готовы" },
    noCritical,
  ];
  if (target === OrderLifecycle.READY_FOR_INSTALLATION) {
    const productionDone = order.productions.some((p) => !!p.completedAt || !!p.actualEndAt || p.percent >= 100);
    checks = [
      { code: "PRODUCTION_COMPLETE", passed: productionDone, message: "Производство не завершено" },
      { code: "QA", passed: !order.qaRequired || !!order.qaApprovedAt, message: "QA не подтверждён" },
      { code: "COMPLETENESS", passed: !!order.completenessConfirmedAt, message: "Комплектность не подтверждена" },
      { code: "MATERIALS", passed: !!order.materialsReadyAt, message: "Материалы или комплектующие не готовы" },
      noCritical,
    ];
  }
  if (target === OrderLifecycle.INSTALLATION) checks = [
    { code: "INSTALLATION_DATE", passed: !!order.installation?.scheduledAt, message: "Дата монтажа не назначена" },
    { code: "INSTALLER", passed: !!order.installation?.installerUserId, message: "Монтажник не назначен" },
    { code: "INSTALLATION_PACKAGE", passed: order.installation?.packageConfirmed === true, message: "Монтажный пакет не подтверждён" },
    { code: "ADDRESS", passed: order.address.trim().length > 0, message: "Адрес не указан" },
    noCritical,
  ];
  if (target === OrderLifecycle.ACCEPTANCE) checks = [
    { code: "INSTALLATION_COMPLETE", passed: !!order.installation?.completedAt || order.installationCompleted, message: "Монтаж не завершён" },
    noCritical,
  ];
  if (target === OrderLifecycle.COMPLETED) checks = [
    { code: "ACCEPTANCE", passed: !!order.operationalAcceptedAt, message: "Приёмка не зафиксирована" },
    noCritical,
  ];
  return { target, passed: checks.every((item) => item.passed), checks };
}

function roleCanTransition(role: Role, from: OrderLifecycle, to: OrderLifecycle) {
  if (role === Role.DIRECTOR) return true;
  if (to === OrderLifecycle.CANCELLED) return role === Role.MANAGER && from !== OrderLifecycle.COMPLETED;
  const next = LIFECYCLE.indexOf(to) === LIFECYCLE.indexOf(from) + 1;
  if (!next) return false;
  if (role === Role.MANAGER) return ([OrderLifecycle.PREPARATION, OrderLifecycle.READY_FOR_PRODUCTION, OrderLifecycle.COMPLETED] as OrderLifecycle[]).includes(to);
  if (role === Role.PRODUCTION) return ([OrderLifecycle.IN_PRODUCTION, OrderLifecycle.READY_FOR_INSTALLATION] as OrderLifecycle[]).includes(to);
  if (role === Role.INSTALLER) return ([OrderLifecycle.INSTALLATION, OrderLifecycle.ACCEPTANCE] as OrderLifecycle[]).includes(to);
  return false;
}

export async function availableTransitions(orderId: number, actor: Order360Actor) {
  await assertAccess(orderId, actor);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { lifecycle: true, version: true } });
  const candidates = [...LIFECYCLE, OrderLifecycle.CANCELLED].filter((to) => roleCanTransition(actor.role, order.lifecycle, to));
  return { version: order.version, transitions: await Promise.all(candidates.map(async (to) => ({ to, gate: await evaluateGate(orderId, to) }))) };
}

export async function transitionLifecycle(input: { orderId: number; to: OrderLifecycle; expectedVersion: number; reason?: string; override?: boolean; key: string; requestHash: string }, actor: Order360Actor) {
  await assertAccess(input.orderId, actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.orderLifecycleEvent.findUnique({ where: { idempotencyKey: input.key } });
    if (existing) {
      if (!compareRequestHash(existing.requestHash, input.requestHash)) throw new Order360Error("IDEMPOTENCY_CONFLICT");
      return { event: existing, created: false };
    }
    const order = await tx.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new Order360Error("NOT_FOUND");
    if (order.version !== input.expectedVersion) throw new Order360Error("STALE_VERSION");
    if (!roleCanTransition(actor.role, order.lifecycle, input.to)) throw new Order360Error("TRANSITION_FORBIDDEN");
    const gate = await evaluateGate(input.orderId, input.to);
    if (!gate.passed) {
      if (!(input.override && actor.role === Role.DIRECTOR && input.reason?.trim())) throw new Order360Error("GATE_FAILED");
      await tx.orderGateOverride.create({ data: { orderId: input.orderId, gate: input.to, reason: input.reason.trim(), snapshot: gate as unknown as Prisma.InputJsonValue, authorId: actor.userId, idempotencyKey: `${input.key}:override`, requestHash: input.requestHash } });
    }
    const updated = await tx.order.updateMany({ where: { id: input.orderId, version: input.expectedVersion }, data: { lifecycle: input.to, version: { increment: 1 }, ...(input.to === OrderLifecycle.COMPLETED ? { completedAt: new Date() } : {}) } });
    if (updated.count !== 1) throw new Order360Error("STALE_VERSION");
    const event = await tx.orderLifecycleEvent.create({ data: { orderId: input.orderId, type: input.to === OrderLifecycle.COMPLETED ? "ORDER_COMPLETED" : "LIFECYCLE_TRANSITION", fromLifecycle: order.lifecycle, toLifecycle: input.to, message: input.reason, actorId: actor.userId, actorName: actor.name, role: actor.role, metadata: { gatePassed: gate.passed, override: Boolean(input.override) }, idempotencyKey: input.key, requestHash: input.requestHash } });
    if (input.to === OrderLifecycle.CANCELLED) await reverseMeasurerBonusForCancelledOrder(tx, input.orderId, actor);
    return { event, created: true, version: input.expectedVersion + 1 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function openBlocker(input: { orderId: number; type: string; severity: OrderBlockerSeverity; title: string; comment?: string; responsibleUserId?: number; dueAt?: Date; key: string; requestHash: string }, actor: Order360Actor) {
  await assertAccess(input.orderId, actor);
  if (actor.role === Role.PARTNER) throw new Order360Error("FORBIDDEN");
  const existing = await prisma.orderBlocker.findUnique({ where: { idempotencyKey: input.key } });
  if (existing) {
    if (!compareRequestHash(existing.requestHash, input.requestHash)) throw new Order360Error("IDEMPOTENCY_CONFLICT");
    return { blocker: existing, created: false };
  }
  return prisma.$transaction(async (tx) => {
    const blocker = await tx.orderBlocker.create({ data: { orderId: input.orderId, type: input.type, severity: input.severity, title: input.title, comment: input.comment, responsibleUserId: input.responsibleUserId, dueAt: input.dueAt, openedById: actor.userId, idempotencyKey: input.key, requestHash: input.requestHash } });
    await tx.orderLifecycleEvent.create({ data: { orderId: input.orderId, type: "BLOCKER_OPENED", message: input.title, actorId: actor.userId, actorName: actor.name, role: actor.role, metadata: { blockerId: blocker.id, severity: blocker.severity } } });
    return { blocker, created: true };
  });
}

export async function resolveBlocker(input: { blockerId: number; resolution: string; key: string; requestHash: string }, actor: Order360Actor) {
  const blocker = await prisma.orderBlocker.findUnique({ where: { id: input.blockerId } });
  if (!blocker) throw new Order360Error("NOT_FOUND");
  await assertAccess(blocker.orderId, actor);
  if (blocker.status === OrderBlockerStatus.RESOLVED) return blocker;
  return prisma.$transaction(async (tx) => {
    const updated = await tx.orderBlocker.update({ where: { id: blocker.id }, data: { status: OrderBlockerStatus.RESOLVED, resolvedAt: new Date(), resolvedById: actor.userId, resolution: input.resolution } });
    await tx.orderLifecycleEvent.create({ data: { orderId: blocker.orderId, type: "BLOCKER_RESOLVED", message: input.resolution, actorId: actor.userId, actorName: actor.name, role: actor.role, metadata: { blockerId: blocker.id }, idempotencyKey: input.key, requestHash: input.requestHash } });
    return updated;
  });
}

export async function confirmMilestone(input: { orderId: number; action: string; expectedVersion: number; value?: string | number | boolean; userId?: number; key: string; requestHash: string }, actor: Order360Actor) {
  await assertAccess(input.orderId, actor);
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER) throw new Order360Error("FORBIDDEN");
  const fields: Record<string, Prisma.OrderUpdateInput> = {
    "confirm-contract": { contractConfirmedAt: new Date() },
    "complete-measurement": { controlMeasurementCompletedAt: new Date() },
    "approve-drawing": { drawingApprovedAt: new Date() },
    "confirm-specification": { specificationDefinedAt: new Date() },
    "confirm-workshop": { workshopConfirmedAt: new Date() },
    "confirm-materials": { materialsReadyAt: new Date() },
    "confirm-completeness": { completenessConfirmedAt: new Date() },
    "approve-qa": { qaApprovedAt: new Date() },
    "record-acceptance": { operationalAcceptedAt: new Date() },
    "set-production-deadline": { productionDeadline: new Date(String(input.value)) },
    "set-required-prepayment": { requiredPrepayment: Number(input.value) },
  };
  const data = fields[input.action];
  if (!data) throw new Order360Error("INVALID_COMMAND");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.orderLifecycleEvent.findUnique({ where: { idempotencyKey: input.key } });
    if (existing) return { event: existing, created: false };
    const updated = await tx.order.updateMany({ where: { id: input.orderId, version: input.expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (updated.count !== 1) throw new Order360Error("STALE_VERSION");
    const event = await tx.orderLifecycleEvent.create({ data: { orderId: input.orderId, type: input.action.toUpperCase().replaceAll("-", "_"), actorId: actor.userId, actorName: actor.name, role: actor.role, idempotencyKey: input.key, requestHash: input.requestHash } });
    return { event, created: true, version: input.expectedVersion + 1 };
  });
}

export async function assignInstallation(input: { orderId: number; scheduledAt: Date; installerUserId: number; packageConfirmed: boolean; comment?: string; expectedVersion: number; key: string; requestHash: string }, actor: Order360Actor) {
  await assertAccess(input.orderId, actor);
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER) throw new Order360Error("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.orderLifecycleEvent.findUnique({ where: { idempotencyKey: input.key } });
    if (existing) return { event: existing, created: false };
    const installer = await tx.user.findFirst({ where: { id: input.installerUserId, role: Role.INSTALLER, active: true } });
    if (!installer) throw new Order360Error("INSTALLER_NOT_FOUND");
    const updated = await tx.order.updateMany({ where: { id: input.orderId, version: input.expectedVersion }, data: { version: { increment: 1 } } });
    if (updated.count !== 1) throw new Order360Error("STALE_VERSION");
    await tx.orderInstallation.upsert({ where: { orderId: input.orderId }, create: { orderId: input.orderId, scheduledAt: input.scheduledAt, installerUserId: input.installerUserId, packageConfirmed: input.packageConfirmed, comment: input.comment }, update: { scheduledAt: input.scheduledAt, installerUserId: input.installerUserId, packageConfirmed: input.packageConfirmed, comment: input.comment } });
    const event = await tx.orderLifecycleEvent.create({ data: { orderId: input.orderId, type: "INSTALLATION_SCHEDULED", actorId: actor.userId, actorName: actor.name, role: actor.role, idempotencyKey: input.key, requestHash: input.requestHash } });
    return { event, created: true, version: input.expectedVersion + 1 };
  });
}

export async function completeInstallation(orderId: number, expectedVersion: number, key: string, requestHash: string, actor: Order360Actor) {
  await assertAccess(orderId, actor);
  if (!(actor.role === Role.DIRECTOR || actor.role === Role.INSTALLER)) throw new Order360Error("FORBIDDEN");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.orderLifecycleEvent.findUnique({ where: { idempotencyKey: key } });
    if (existing) return { event: existing, created: false };
    const updated = await tx.order.updateMany({ where: { id: orderId, version: expectedVersion }, data: { installationCompleted: true, version: { increment: 1 } } });
    if (updated.count !== 1) throw new Order360Error("STALE_VERSION");
    await tx.orderInstallation.update({ where: { orderId }, data: { completedAt: new Date() } });
    const event = await tx.orderLifecycleEvent.create({ data: { orderId, type: "INSTALLATION_COMPLETED", actorId: actor.userId, actorName: actor.name, role: actor.role, idempotencyKey: key, requestHash } });
    return { event, created: true, version: expectedVersion + 1 };
  });
}

export async function orderAttention(orderId: number, actor: Order360Actor) {
  await assertAccess(orderId, actor);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { documents: { select: { type: true } }, measurements: { select: { id: true } }, productions: { select: { plannedEndAt: true, completedAt: true } }, blockers: { where: { status: OrderBlockerStatus.OPEN }, include: { responsibleUser: { select: { id: true, name: true } } } }, installation: true } });
  const now = new Date();
  const signals: Array<{ type: string; severity: string; message: string; responsible: unknown; dueAt: Date | null; actionCode: string; deepLink: string }> = [];
  const push = (type: string, severity: string, message: string, dueAt: Date | null = null) => signals.push({ type, severity, message, responsible: order.managerUserId, dueAt, actionCode: type, deepLink: `/orders/${order.id}` });
  if ((actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT || actor.role === Role.MANAGER) && Number(order.balance) > 0 && order.promisedAt && order.promisedAt < now) push("PAYMENT_OVERDUE", "WARNING", "Просрочен платёж", order.promisedAt);
  if (!order.contractConfirmedAt && !order.documents.some((d) => d.type === "CONTRACT")) push("CONTRACT_MISSING", "WARNING", "Нет подтверждённого договора");
  if (!order.controlMeasurementCompletedAt && !order.measurements.length) push("MEASUREMENT_MISSING", "WARNING", "Нет контрольного замера");
  if (!order.drawingApprovedAt) push("DRAWING_MISSING", "WARNING", "Проект или чертёж не согласован");
  if (order.productions.some((p) => p.plannedEndAt && p.plannedEndAt < now && !p.completedAt)) push("PRODUCTION_DELAY", "CRITICAL", "Производство задерживается");
  if (!order.materialsReadyAt) push("MATERIALS_MISSING", "WARNING", "Материалы не подтверждены");
  if (order.lifecycle === OrderLifecycle.READY_FOR_INSTALLATION && !order.installation) push("INSTALLATION_NOT_SCHEDULED", "WARNING", "Монтаж не назначен");
  if ((actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT || actor.role === Role.PARTNER) && Number(order.partnerBalance) > 0) push("WORKSHOP_PAYABLE", "INFO", "Есть остаток к выплате ЦЕХ");
  for (const blocker of order.blockers) signals.push({ type: "OPEN_BLOCKER", severity: blocker.severity, message: blocker.title, responsible: blocker.responsibleUser, dueAt: blocker.dueAt, actionCode: "RESOLVE_BLOCKER", deepLink: `/orders/${order.id}?blocker=${blocker.id}` });
  return signals;
}

export async function orderOverview(orderId: number, actor: Order360Actor) {
  await assertAccess(orderId, actor);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { id: true, number: true, lifecycle: true, version: true, promisedAt: true, createdAt: true, updatedAt: true, managerUserId: true, manager: true, amount: true, prepayment: true, balance: true, partnerPrice: true, partnerPaid: true, partnerBalance: true, companyProfit: true, client: { select: { id: true, name: true, phone: true, city: true, address: true } }, partner: { select: { id: true, name: true } }, installation: { select: { scheduledAt: true, completedAt: true, installerUser: { select: { id: true, name: true } } } }, lifecycleEvents: { take: 5, orderBy: { createdAt: "desc" }, select: { id: true, type: true, message: true, actorName: true, createdAt: true } } } });
  const attention = await orderAttention(orderId, actor);
  const days = order.promisedAt ? Math.ceil((order.promisedAt.getTime() - Date.now()) / 86400000) : null;
  const result: Record<string, unknown> = { id: order.id, number: order.number, lifecycle: order.lifecycle, version: order.version, promisedAt: order.promisedAt, daysRemaining: days, overdue: days != null && days < 0, health: attention.some((x) => x.severity === "CRITICAL") ? "CRITICAL" : attention.length ? "ATTENTION" : "OK", attentionCount: attention.length, manager: { id: order.managerUserId, name: order.manager }, client: order.client, delivery: order.installation, lastActivities: order.lifecycleEvents };
  if (actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT) result.finance = { clientPrice: order.amount, received: order.prepayment, receivable: order.balance, ...(actor.role === Role.DIRECTOR ? { workshopPrice: order.partnerPrice, workshopPaid: order.partnerPaid, workshopPayable: order.partnerBalance, companyProfit: order.companyProfit } : {}) };
  else if (actor.role === Role.MANAGER) result.commerce = { clientPrice: order.amount, received: order.prepayment, receivable: order.balance };
  else if (actor.role === Role.PARTNER) result.workshop = { price: order.partnerPrice, paid: order.partnerPaid, payable: order.partnerBalance };
  return result;
}

export async function orderFinance(orderId: number, actor: Order360Actor) {
  await assertAccess(orderId, actor);
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { amount: true, prepayment: true, balance: true, partnerPrice: true, partnerPaid: true, partnerBalance: true, companyProfit: true } });
  if (actor.role === Role.PRODUCTION || actor.role === Role.INSTALLER || actor.role === Role.MEASURER) throw new Order360Error("FORBIDDEN");
  if (actor.role === Role.PARTNER) return { workshopPrice: order.partnerPrice, workshopPaid: order.partnerPaid, workshopPayable: order.partnerBalance };
  if (actor.role === Role.MANAGER) return { clientPrice: order.amount, received: order.prepayment, receivable: order.balance };
  return { clientPrice: order.amount, received: order.prepayment, receivable: order.balance, workshopPrice: order.partnerPrice, workshopPaid: order.partnerPaid, workshopPayable: order.partnerBalance, ...(actor.role === Role.DIRECTOR ? { companyProfit: order.companyProfit } : {}) };
}

export async function orderTimeline(orderId: number, actor: Order360Actor, page: number, pageSize: number) {
  await assertAccess(orderId, actor);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  const safePage = Math.max(1, page), take = safePage * safeSize;
  const includeLegacy = actor.role === Role.DIRECTOR || actor.role === Role.ACCOUNTANT || actor.role === Role.MANAGER;
  const [typed, statuses, legacy] = await Promise.all([
    prisma.orderLifecycleEvent.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take, select: { id: true, type: true, fromLifecycle: true, toLifecycle: true, message: true, actorName: true, role: true, createdAt: true } }),
    prisma.orderStatusHistory.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take, select: { id: true, fromStatus: true, toStatus: true, changedByName: true, changedByRole: true, comment: true, createdAt: true } }),
    includeLegacy ? prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: "desc" }, take, select: { id: true, title: true, description: true, user: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  const events = [
    ...typed.map((row) => ({ ...row, source: "LIFECYCLE" as const })),
    ...statuses.map((row) => ({ id: `status:${row.id}`, type: "LEGACY_STATUS_CHANGED", fromStatus: row.fromStatus, toStatus: row.toStatus, message: row.comment, actorName: row.changedByName, role: row.changedByRole, createdAt: row.createdAt, source: "STATUS" as const })),
    ...legacy.map((row) => ({ id: `event:${row.id}`, type: "LEGACY_EVENT", message: row.title, description: row.description, actorName: row.user, createdAt: row.createdAt, source: "EVENT" as const })),
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice((safePage - 1) * safeSize, safePage * safeSize);
  return { page: safePage, pageSize: safeSize, events };
}

export async function orderMaterials(orderId: number, actor: Order360Actor) {
  await assertAccess(orderId, actor);
  return prisma.materialReservation.findMany({ where: { orderId }, select: { id: true, quantity: true, consumed: true, status: true, material: { select: { id: true, name: true, category: true, unit: true, stock: true, reserved: true } } }, orderBy: { id: "asc" } });
}

export async function orderDocuments(orderId: number, actor: Order360Actor, page: number, pageSize: number) {
  await assertAccess(orderId, actor);
  const safeSize = Math.min(50, Math.max(1, pageSize));
  return prisma.document.findMany({ where: { orderId }, select: { id: true, type: true, number: true, documentDate: true, createdAt: true }, orderBy: { createdAt: "desc" }, skip: (Math.max(1, page) - 1) * safeSize, take: safeSize });
}
