import { createHash } from "node:crypto";
import { EmployeeHandoverStatus, OrderLifecycle, Prisma, Role } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";
import { HANDOVER_CATEGORIES, type HandoverCategory, type HandoverSelection } from "@/lib/services/employee-handover-categories";

type Db = Prisma.TransactionClient;
type WorkRow = { id: number; title: string; oldName?: string; snapshot?: Record<string, string | null>; updatedAt?: Date };
type Work = Record<HandoverCategory, WorkRow[]>;

export class HandoverError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function parseSelection(value: unknown): HandoverSelection {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(HANDOVER_CATEGORIES.map((key) => [key, input[key] !== false])) as HandoverSelection;
}

function idList(rows: WorkRow[]) { return rows.map((row) => row.id); }

async function collectWork(db: Db, companyId: number, fromUserId: number): Promise<Work> {
  const [clients, orders, tasks, followUps, approvals, blockers, marketingTasks, recruitment] = await Promise.all([
    db.client.findMany({ where: { companyId, managerUserId: fromUserId, deletedAt: null, OR: [{ active: true }, { orders: { some: { deletedAt: null, lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] } } } }, { followUps: { some: { completedAt: null } } }] }, select: { id: true, name: true, manager: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.order.findMany({ where: { companyId, managerUserId: fromUserId, deletedAt: null, lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] } }, select: { id: true, number: true, manager: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.calendarTask.findMany({ where: { companyId, assigneeId: fromUserId, status: { in: ["PLANNED", "IN_PROGRESS"] } }, select: { id: true, title: true, acknowledgedAt: true, acknowledgementComment: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.leadFollowUp.findMany({ where: { managerUserId: fromUserId, completedAt: null, client: { companyId, deletedAt: null } }, select: { id: true, managerName: true, nextActionAt: true, client: { select: { name: true } } }, orderBy: { id: "asc" } }),
    db.priceApprovalRequest.findMany({ where: { managerUserId: fromUserId, status: "PENDING", client: { companyId, deletedAt: null } }, select: { id: true, managerName: true, updatedAt: true, client: { select: { name: true } } }, orderBy: { id: "asc" } }),
    db.orderBlocker.findMany({ where: { responsibleUserId: fromUserId, status: "OPEN", order: { companyId, deletedAt: null } }, select: { id: true, title: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.managementMarketingTask.findMany({ where: { companyId, assigneeId: fromUserId, status: { not: "DONE" } }, select: { id: true, title: true, updatedAt: true }, orderBy: { id: "asc" } }),
    db.recruitmentCandidate.findMany({ where: { companyId, responsibleUserId: fromUserId, status: { notIn: ["HIRED", "REJECTED"] } }, select: { id: true, name: true, updatedAt: true }, orderBy: { id: "asc" } }),
  ]);
  return {
    clients: clients.map(({ id, name, manager, updatedAt }) => ({ id, title: name, oldName: manager, updatedAt })),
    orders: orders.map(({ id, number, manager, updatedAt }) => ({ id, title: number, oldName: manager, updatedAt })),
    tasks: tasks.map(({ id, title, acknowledgedAt, acknowledgementComment, updatedAt }) => ({ id, title, updatedAt, snapshot: { acknowledgedAt: acknowledgedAt?.toISOString() ?? null, acknowledgementComment } })),
    followUps: followUps.map(({ id, client, managerName, nextActionAt }) => ({ id, title: client.name, oldName: managerName, snapshot: { nextActionAt: nextActionAt.toISOString() } })),
    approvals: approvals.map(({ id, client, managerName, updatedAt }) => ({ id, title: client.name, oldName: managerName, updatedAt })),
    blockers,
    marketingTasks,
    recruitment: recruitment.map(({ id, name, updatedAt }) => ({ id, title: name, updatedAt })),
  };
}

async function collectExceptions(db: Db, companyId: number, fromUserId: number) {
  const [cashShifts, draftDocuments, plans, linkedReminders, marketingTasks, recruitment] = await Promise.all([
    db.cashShift.findMany({ where: { companyId, responsibleManagerId: fromUserId, status: "OPEN" }, select: { id: true }, orderBy: { id: "asc" } }),
    db.document.findMany({ where: { companyId, authorId: fromUserId, status: { in: ["DRAFT", "READY"] } }, select: { id: true, title: true }, orderBy: { id: "asc" } }),
    db.salesPlanManagerTarget.findMany({ where: { managerId: fromUserId, plan: { companyId } }, select: { id: true, plan: { select: { year: true, month: true } } }, orderBy: { id: "asc" } }),
    db.leadNextAction.count({ where: { completedAt: null, client: { companyId, managerUserId: fromUserId, deletedAt: null } } }),
    db.managementMarketingTask.findMany({ where: { companyId, assigneeId: fromUserId, status: { not: "DONE" } }, select: { id: true } }),
    db.recruitmentCandidate.findMany({ where: { companyId, responsibleUserId: fromUserId, status: { notIn: ["HIRED", "REJECTED"] } }, select: { id: true } }),
  ]);
  return {
    blocking: [
      ...cashShifts.map(({ id }) => ({ kind: "cashShift", id, reason: "Открытую кассовую смену нужно закрыть вручную до передачи" })),
      ...marketingTasks.map(({ id }) => ({ kind: "marketingTask", id, reason: "Роль менеджера не видит кабинет маркетинга. Назначьте задачу сотруднику с доступом до передачи" })),
      ...recruitment.map(({ id }) => ({ kind: "recruitment", id, reason: "Роль менеджера не видит подбор персонала. Назначьте кандидата сотруднику с доступом до передачи" })),
    ],
    informational: [
      ...draftDocuments.map(({ id, title }) => ({ kind: "document", id, reason: `Документ «${title}» хранит авторство; проверьте согласование вручную` })),
      ...plans.map(({ id, plan }) => ({ kind: "salesPlan", id, reason: `План ${plan.month}.${plan.year} остаётся у прежнего менеджера; новый план назначьте отдельно` })),
      ...(linkedReminders ? [{ kind: "linkedReminders", id: 0, reason: `${linkedReminders} напоминаний связаны с передаваемыми клиентами и следуют за новым текущим ответственным; авторство сохранено` }] : []),
    ],
  };
}

export async function previewHandover(fromUserId: number, selection: HandoverSelection) {
  const companyId = requireTenantIdentity().companyId;
  const user = await prisma.user.findFirst({ where: { id: fromUserId, companyId, role: Role.MANAGER }, select: { id: true, name: true, active: true } });
  if (!user) throw new HandoverError("Выберите менеджера этой компании", 404);
  const [work, exceptions] = await Promise.all([collectWork(prisma, companyId, fromUserId), collectExceptions(prisma, companyId, fromUserId)]);
  const unselected = HANDOVER_CATEGORIES.filter((key) => !selection[key] && work[key].length > 0);
  const fingerprint = createHash("sha256").update(JSON.stringify(work)).digest("hex");
  return { user, work, counts: Object.fromEntries(HANDOVER_CATEGORIES.map((key) => [key, work[key].length])), exceptions, unselected, fingerprint };
}

async function verifyPeople(db: Db, companyId: number, fromUserId: number, toUserId: number) {
  if (fromUserId === toUserId) throw new HandoverError("Выберите другого сотрудника");
  const [from, to] = await Promise.all([
    db.user.findFirst({ where: { id: fromUserId, companyId, role: Role.MANAGER }, select: { id: true, name: true, active: true } }),
    db.user.findFirst({ where: { id: toUserId, companyId, role: Role.MANAGER }, select: { id: true, name: true, active: true, payrollProfile: { select: { id: true } } } }),
  ]);
  if (!from?.active) throw new HandoverError("Прежний менеджер уже неактивен");
  if (!to || !to.payrollProfile) throw new HandoverError("Новый менеджер должен иметь отдельную учётную запись и профиль");
  if (to.active) throw new HandoverError("Для подготовки выберите отдельный неактивный аккаунт нового менеджера");
  return { from, to };
}

export async function listHandovers() {
  const companyId = requireTenantIdentity().companyId;
  return prisma.employeeHandover.findMany({ where: { companyId }, include: { fromUser: { select: { name: true, active: true } }, toUser: { select: { name: true, active: true } }, preparedBy: { select: { name: true } }, confirmedBy: { select: { name: true } }, items: { select: { kind: true, entityId: true, oldName: true, newName: true } } }, orderBy: { createdAt: "desc" }, take: 30 });
}

export async function listHandoverManagers() {
  const companyId = requireTenantIdentity().companyId;
  return prisma.user.findMany({ where: { companyId, role: Role.MANAGER }, select: { id: true, name: true, active: true, payrollProfile: { select: { id: true } } }, orderBy: { name: "asc" } });
}

export async function prepareHandover(input: { fromUserId: number; toUserId: number; scheduledAt: Date; categories: HandoverSelection; actorId: number }) {
  const companyId = requireTenantIdentity().companyId;
  if (!Number.isFinite(input.scheduledAt.getTime()) || input.scheduledAt.getTime() <= Date.now()) throw new HandoverError("Укажите будущую дату и время передачи");
  return prisma.$transaction(async (tx) => {
    await verifyPeople(tx, companyId, input.fromUserId, input.toUserId);
    const existing = await tx.employeeHandover.count({ where: { companyId, status: EmployeeHandoverStatus.PREPARED, OR: [{ fromUserId: input.fromUserId }, { toUserId: input.toUserId }] } });
    if (existing) throw new HandoverError("Для одного из сотрудников уже подготовлена передача", 409);
    return tx.employeeHandover.create({ data: { companyId, fromUserId: input.fromUserId, toUserId: input.toUserId, scheduledAt: input.scheduledAt, categories: input.categories, preparedById: input.actorId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function editHandover(id: number, input: { action: "update" | "cancel"; scheduledAt?: Date; toUserId?: number; categories?: HandoverSelection }) {
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.employeeHandover.findFirst({ where: { id, companyId, status: "PREPARED" } });
    if (!plan) throw new HandoverError("Подготовленная передача не найдена", 404);
    if (input.action === "cancel") return tx.employeeHandover.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
    if (input.scheduledAt && (!Number.isFinite(input.scheduledAt.getTime()) || (input.scheduledAt.getTime() <= Date.now() && input.scheduledAt.getTime() !== plan.scheduledAt.getTime()))) throw new HandoverError("Укажите будущую дату");
    if (input.toUserId && input.toUserId !== plan.toUserId) {
      await verifyPeople(tx, companyId, plan.fromUserId, input.toUserId);
      const duplicate = await tx.employeeHandover.count({ where: { companyId, status: "PREPARED", toUserId: input.toUserId, id: { not: id } } });
      if (duplicate) throw new HandoverError("Для нового менеджера уже подготовлена передача", 409);
    }
    return tx.employeeHandover.update({ where: { id }, data: { scheduledAt: input.scheduledAt, toUserId: input.toUserId, categories: input.categories } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function confirmHandover(id: number, fingerprint: string, actorId: number) {
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.employeeHandover.findFirst({ where: { id, companyId, status: "PREPARED" } });
    if (!plan) throw new HandoverError("Подготовленная передача не найдена", 404);
    const now = new Date();
    if (plan.scheduledAt > now) throw new HandoverError("Назначенное время ещё не наступило", 409);
    const { from, to } = await verifyPeople(tx, companyId, plan.fromUserId, plan.toUserId);
    const work = await collectWork(tx, companyId, plan.fromUserId);
    const currentFingerprint = createHash("sha256").update(JSON.stringify(work)).digest("hex");
    if (fingerprint !== currentFingerprint) throw new HandoverError("Список изменился. Обновите предварительный просмотр и подтвердите снова", 409);
    const selection = parseSelection(plan.categories);
    if (HANDOVER_CATEGORIES.some((key) => !selection[key] && work[key].length)) throw new HandoverError("Остались невыбранные активные записи. Выберите их или завершите вручную", 409);
    const targetWork = await collectWork(tx, companyId, plan.toUserId);
    if (HANDOVER_CATEGORIES.some((key) => targetWork[key].length)) throw new HandoverError("У нового аккаунта уже есть текущие рабочие записи. Разберите их до перехода", 409);
    const exceptions = await collectExceptions(tx, companyId, plan.fromUserId);
    if (exceptions.blocking.length) throw new HandoverError("Сначала разберите блокирующие исключения из предварительного просмотра", 409);
    const assertMoved = (count: number, expected: number) => { if (count !== expected) throw new HandoverError("Список изменился во время передачи. Операция отменена", 409); };
    const moved: Record<string, number> = {};
    const items = HANDOVER_CATEGORIES.flatMap((key) => work[key].map((row) => ({ handoverId: id, kind: key, entityId: row.id, oldName: row.oldName ?? from.name, newName: to.name, snapshot: row.snapshot ?? Prisma.JsonNull, transferredAt: now })));
    moved.clients = (await tx.client.updateMany({ where: { companyId, id: { in: idList(work.clients) }, managerUserId: from.id }, data: { managerUserId: to.id, manager: to.name } })).count; assertMoved(moved.clients, work.clients.length);
    moved.orders = (await tx.order.updateMany({ where: { companyId, id: { in: idList(work.orders) }, managerUserId: from.id }, data: { managerUserId: to.id, manager: to.name } })).count; assertMoved(moved.orders, work.orders.length);
    moved.tasks = (await tx.calendarTask.updateMany({ where: { companyId, id: { in: idList(work.tasks) }, assigneeId: from.id }, data: { assigneeId: to.id, acknowledgedAt: null, acknowledgementComment: null } })).count; assertMoved(moved.tasks, work.tasks.length);
    moved.followUps = (await tx.leadFollowUp.updateMany({ where: { id: { in: idList(work.followUps) }, managerUserId: from.id, client: { companyId } }, data: { managerUserId: to.id, managerName: to.name } })).count; assertMoved(moved.followUps, work.followUps.length);
    moved.approvals = (await tx.priceApprovalRequest.updateMany({ where: { id: { in: idList(work.approvals) }, managerUserId: from.id, client: { companyId } }, data: { managerUserId: to.id, managerName: to.name } })).count; assertMoved(moved.approvals, work.approvals.length);
    moved.blockers = (await tx.orderBlocker.updateMany({ where: { id: { in: idList(work.blockers) }, responsibleUserId: from.id, order: { companyId } }, data: { responsibleUserId: to.id } })).count; assertMoved(moved.blockers, work.blockers.length);
    moved.marketingTasks = (await tx.managementMarketingTask.updateMany({ where: { companyId, id: { in: idList(work.marketingTasks) }, assigneeId: from.id }, data: { assigneeId: to.id } })).count; assertMoved(moved.marketingTasks, work.marketingTasks.length);
    moved.recruitment = (await tx.recruitmentCandidate.updateMany({ where: { companyId, id: { in: idList(work.recruitment) }, responsibleUserId: from.id }, data: { responsibleUserId: to.id } })).count; assertMoved(moved.recruitment, work.recruitment.length);
    if (items.length) await tx.employeeHandoverItem.createMany({ data: items });
    if (work.clients.length) await tx.clientInteraction.createMany({ data: work.clients.map((row) => ({ clientId: row.id, authorId: actorId, authorName: "Директор", comment: `Передача дел: ранее ответственный — ${from.name}; текущий — ${to.name}; передано директором ${now.toISOString()}` })) });
    if (work.orders.length) await tx.orderEvent.createMany({ data: work.orders.map((row) => ({ companyId, orderId: row.id, title: "Передача дел", description: `Ранее ответственный — ${from.name}; текущий — ${to.name}; передано директором ${now.toISOString()}`, user: "Директор" })) });
    if (work.tasks.length) await tx.calendarTaskAudit.createMany({ data: work.tasks.map((row) => ({ taskId: row.id, action: "HANDOVER", before: { assigneeId: from.id, name: from.name }, after: { assigneeId: to.id, name: to.name }, actorId })) });
    assertMoved((await tx.user.updateMany({ where: { id: from.id, companyId, active: true }, data: { active: false, sessionVersion: { increment: 1 } } })).count, 1);
    assertMoved((await tx.user.updateMany({ where: { id: to.id, companyId, active: false }, data: { active: true, sessionVersion: { increment: 1 } } })).count, 1);
    const [oldProfile, newProfile] = await Promise.all([tx.employeePayrollProfile.findFirst({ where: { companyId, userId: from.id }, select: { active: true, terminatedAt: true } }), tx.employeePayrollProfile.findFirst({ where: { companyId, userId: to.id }, select: { active: true, hiredAt: true, terminatedAt: true } })]);
    await tx.employeePayrollProfile.updateMany({ where: { companyId, userId: from.id }, data: { active: false, terminatedAt: now } });
    await tx.employeePayrollProfile.updateMany({ where: { companyId, userId: to.id }, data: { active: true, hiredAt: now, terminatedAt: null } });
    const report = { moved, exceptions: exceptions.informational, rule: "Продажа и заявка относятся к менеджеру на дату регистрации. Действия после передачи относятся к новому ответственному.", confirmedAt: now.toISOString(), previousProfiles: { oldActive: oldProfile?.active ?? null, oldTerminatedAt: oldProfile?.terminatedAt?.toISOString() ?? null, newActive: newProfile?.active ?? null, newHiredAt: newProfile?.hiredAt.toISOString() ?? null, newTerminatedAt: newProfile?.terminatedAt?.toISOString() ?? null } };
    await tx.employeeHandoverNotice.create({ data: { handoverId: id, userId: to.id, text: `Вам переданы дела ${from.name}: ${work.clients.length} клиентов, ${work.orders.length} заказов, ${work.tasks.length} задач. Откройте соответствующие разделы.` } });
    await tx.employeeHandover.update({ where: { id }, data: { status: "COMPLETED", confirmedAt: now, confirmedById: actorId, report } });
    return report;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
}

export async function rollbackHandover(id: number, actorId: number) {
  const companyId = requireTenantIdentity().companyId;
  return prisma.$transaction(async (tx) => {
    const plan = await tx.employeeHandover.findFirst({ where: { id, companyId, status: "COMPLETED" }, include: { items: true, fromUser: { select: { name: true, active: true, updatedAt: true } }, toUser: { select: { name: true, active: true, lastLogin: true, updatedAt: true } } } });
    if (!plan?.confirmedAt) throw new HandoverError("Завершённая передача не найдена", 404);
    const incompatible = () => new HandoverError("После передачи появились изменения. Автоматический откат заблокирован; проверьте записи вручную", 409);
    if (plan.fromUser.active || !plan.toUser.active || (plan.toUser.lastLogin && plan.toUser.lastLogin > plan.confirmedAt) || plan.fromUser.updatedAt > plan.updatedAt || plan.toUser.updatedAt > plan.updatedAt) throw incompatible();
    const otherPlans = await tx.employeeHandover.count({ where: { companyId, id: { not: id }, status: "PREPARED", OR: [{ fromUserId: plan.toUserId }, { toUserId: plan.fromUserId }, { fromUserId: plan.fromUserId }, { toUserId: plan.toUserId }] } });
    if (otherPlans) throw incompatible();
    const work = await collectWork(tx, companyId, plan.toUserId);
    for (const key of HANDOVER_CATEGORIES) {
      const expected = plan.items.filter((item) => item.kind === key).map((item) => item.entityId).sort((a, b) => a - b);
      const actual = work[key].map((row) => row.id).sort((a, b) => a - b);
      if (JSON.stringify(expected) !== JSON.stringify(actual)) throw incompatible();
      if (work[key].some((row) => row.updatedAt && row.updatedAt > plan.updatedAt)) throw incompatible();
    }
    const byKind = (key: HandoverCategory) => plan.items.filter((item) => item.kind === key);
    for (const row of work.followUps) {
      const item = byKind("followUps").find((candidate) => candidate.entityId === row.id);
      const old = item?.snapshot as { nextActionAt?: string } | null;
      if (!old || old.nextActionAt !== row.snapshot?.nextActionAt) throw incompatible();
    }
    if (work.tasks.some((row) => row.snapshot?.acknowledgedAt !== null || row.snapshot?.acknowledgementComment !== null)) throw incompatible();
    const changedChildren = await Promise.all([
      tx.clientInteraction.count({ where: { clientId: { in: byKind("clients").map((item) => item.entityId) }, createdAt: { gt: plan.updatedAt } } }),
      tx.leadActivity.count({ where: { clientId: { in: byKind("clients").map((item) => item.entityId) }, createdAt: { gt: plan.updatedAt } } }),
      tx.leadNextAction.count({ where: { clientId: { in: byKind("clients").map((item) => item.entityId) }, createdAt: { gt: plan.updatedAt } } }),
      tx.orderEvent.count({ where: { orderId: { in: byKind("orders").map((item) => item.entityId) }, createdAt: { gt: plan.updatedAt } } }),
      tx.payment.count({ where: { orderId: { in: byKind("orders").map((item) => item.entityId) }, createdAt: { gt: plan.updatedAt } } }),
      tx.calendarTaskAudit.count({ where: { taskId: { in: byKind("tasks").map((item) => item.entityId) }, createdAt: { gt: plan.updatedAt } } }),
    ]);
    if (changedChildren.some(Boolean)) throw incompatible();
    const restored = { clients: 0, orders: 0, tasks: 0, followUps: 0, approvals: 0, blockers: 0, marketingTasks: 0, recruitment: 0 } as Record<HandoverCategory, number>;
    for (const item of byKind("clients")) restored.clients += (await tx.client.updateMany({ where: { id: item.entityId, companyId, managerUserId: plan.toUserId }, data: { managerUserId: plan.fromUserId, manager: item.oldName ?? plan.fromUser.name } })).count;
    for (const item of byKind("orders")) restored.orders += (await tx.order.updateMany({ where: { id: item.entityId, companyId, managerUserId: plan.toUserId }, data: { managerUserId: plan.fromUserId, manager: item.oldName ?? plan.fromUser.name } })).count;
    for (const item of byKind("tasks")) {
      const old = item.snapshot as { acknowledgedAt?: string | null; acknowledgementComment?: string | null } | null;
      restored.tasks += (await tx.calendarTask.updateMany({ where: { id: item.entityId, companyId, assigneeId: plan.toUserId }, data: { assigneeId: plan.fromUserId, acknowledgedAt: old?.acknowledgedAt ? new Date(old.acknowledgedAt) : null, acknowledgementComment: old?.acknowledgementComment ?? null } })).count;
    }
    for (const item of byKind("followUps")) restored.followUps += (await tx.leadFollowUp.updateMany({ where: { id: item.entityId, managerUserId: plan.toUserId, client: { companyId } }, data: { managerUserId: plan.fromUserId, managerName: item.oldName ?? plan.fromUser.name } })).count;
    for (const item of byKind("approvals")) restored.approvals += (await tx.priceApprovalRequest.updateMany({ where: { id: item.entityId, managerUserId: plan.toUserId, client: { companyId } }, data: { managerUserId: plan.fromUserId, managerName: item.oldName ?? plan.fromUser.name } })).count;
    for (const item of byKind("blockers")) restored.blockers += (await tx.orderBlocker.updateMany({ where: { id: item.entityId, responsibleUserId: plan.toUserId, order: { companyId } }, data: { responsibleUserId: plan.fromUserId } })).count;
    for (const item of byKind("marketingTasks")) restored.marketingTasks += (await tx.managementMarketingTask.updateMany({ where: { id: item.entityId, companyId, assigneeId: plan.toUserId }, data: { assigneeId: plan.fromUserId } })).count;
    for (const item of byKind("recruitment")) restored.recruitment += (await tx.recruitmentCandidate.updateMany({ where: { id: item.entityId, companyId, responsibleUserId: plan.toUserId }, data: { responsibleUserId: plan.fromUserId } })).count;
    if (HANDOVER_CATEGORIES.some((key) => restored[key] !== byKind(key).length)) throw incompatible();
    const previous = (plan.report as { previousProfiles?: { oldActive?: boolean | null; oldTerminatedAt?: string | null; newActive?: boolean | null; newHiredAt?: string | null; newTerminatedAt?: string | null } } | null)?.previousProfiles;
    if (!previous?.newHiredAt) throw incompatible();
    await tx.user.update({ where: { id: plan.fromUserId }, data: { active: true, sessionVersion: { increment: 1 } } });
    await tx.user.update({ where: { id: plan.toUserId }, data: { active: false, sessionVersion: { increment: 1 } } });
    await tx.employeePayrollProfile.updateMany({ where: { companyId, userId: plan.fromUserId }, data: { active: previous.oldActive ?? true, terminatedAt: previous.oldTerminatedAt ? new Date(previous.oldTerminatedAt) : null } });
    await tx.employeePayrollProfile.updateMany({ where: { companyId, userId: plan.toUserId }, data: { active: previous.newActive ?? false, hiredAt: new Date(previous.newHiredAt), terminatedAt: previous.newTerminatedAt ? new Date(previous.newTerminatedAt) : null } });
    const now = new Date();
    if (byKind("clients").length) await tx.clientInteraction.createMany({ data: byKind("clients").map((item) => ({ clientId: item.entityId, authorId: actorId, authorName: "Директор", comment: `Откат передачи дел #${id}: текущий ответственный снова ${plan.fromUser.name}; ${now.toISOString()}` })) });
    if (byKind("orders").length) await tx.orderEvent.createMany({ data: byKind("orders").map((item) => ({ companyId, orderId: item.entityId, title: "Откат передачи дел", description: `Ответственный снова ${plan.fromUser.name}; ${now.toISOString()}`, user: "Директор" })) });
    if (byKind("tasks").length) await tx.calendarTaskAudit.createMany({ data: byKind("tasks").map((item) => ({ taskId: item.entityId, action: "HANDOVER_ROLLBACK", before: { assigneeId: plan.toUserId }, after: { assigneeId: plan.fromUserId }, actorId })) });
    await tx.employeeHandover.update({ where: { id }, data: { status: "ROLLED_BACK", rolledBackAt: now } });
    return { restored, rolledBackAt: now.toISOString() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 });
}
