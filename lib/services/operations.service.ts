import bcrypt from "bcrypt";
import {
  CalendarTaskStatus,
  DocumentStatus,
  DocumentType,
  MeasurementStatus,
  OperationalAccessAuditAction,
  OperationalScope,
  OperationalWorkItemPriority,
  OperationalWorkItemStatus,
  OrderLifecycle,
  PayrollDirection,
  PayrollPaymentType,
  Prisma,
  Role,
} from "@prisma/client";

import {
  accessExpiry,
  generateTemporaryPassword,
  OPERATIONS_DIRECTOR_EMAIL,
  OPERATIONS_DIRECTOR_NAME,
  remainingAccessDays,
  isSafeOperationalUrl,
} from "@/lib/operations/access";
import { prisma } from "@/lib/prisma";
import { getCompanyProfitability } from "@/lib/services/profitability.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

export class OperationsError extends Error {}

export type OperationsActor = {
  userId: number;
  role: Role;
  name: string;
  ordaProjectOperationsEnabled?: boolean;
  companyOperationsEnabled?: boolean;
};

const unfinishedWorkStatuses = [
  OperationalWorkItemStatus.OPEN,
  OperationalWorkItemStatus.IN_PROGRESS,
  OperationalWorkItemStatus.BLOCKED,
];

function operationalUrl(value: unknown) {
  try {
    return isSafeOperationalUrl(value);
  } catch {
    throw new OperationsError("INVALID_URL");
  }
}

function assertLiveOperationsTenant() {
  const tenant = requireTenantIdentity();
  if (tenant.companyId !== 1 || tenant.isDemo)
    throw new OperationsError("LIVE_COMPANY_REQUIRED");
  return tenant;
}

function assertDirector(actor: OperationsActor) {
  if (actor.role !== Role.DIRECTOR) throw new OperationsError("FORBIDDEN");
  assertLiveOperationsTenant();
}

function scopeEnabled(actor: OperationsActor, scope: OperationalScope) {
  if (actor.role === Role.DIRECTOR) return true;
  if (actor.role !== Role.OPERATIONS_DIRECTOR) return false;
  return scope === OperationalScope.ORDA_PROJECT
    ? actor.ordaProjectOperationsEnabled === true
    : actor.companyOperationsEnabled === true;
}

export function assertOperationalScope(actor: OperationsActor, scope: OperationalScope) {
  assertLiveOperationsTenant();
  if (!scopeEnabled(actor, scope)) throw new OperationsError("SCOPE_DISABLED");
}

const userAccessSelect = {
  id: true,
  companyId: true,
  name: true,
  email: true,
  role: true,
  active: true,
  temporaryAccess: true,
  accessExpiresAt: true,
  accessRevokedAt: true,
  revokeReason: true,
  ordaProjectOperationsEnabled: true,
  companyOperationsEnabled: true,
  sessionVersion: true,
  lastLogin: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

type AccessUser = Prisma.UserGetPayload<{ select: typeof userAccessSelect }>;

function accessSnapshot(user: AccessUser) {
  return {
    id: user.id,
    companyId: user.companyId,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    temporaryAccess: user.temporaryAccess,
    accessExpiresAt: user.accessExpiresAt?.toISOString() ?? null,
    accessRevokedAt: user.accessRevokedAt?.toISOString() ?? null,
    ordaProjectOperationsEnabled: user.ordaProjectOperationsEnabled,
    companyOperationsEnabled: user.companyOperationsEnabled,
    sessionVersion: user.sessionVersion,
  } satisfies Prisma.InputJsonObject;
}

function accessDto(user: AccessUser | null, grantedAt?: Date | null) {
  if (!user) return null;
  return {
    ...user,
    grantedAt: grantedAt ?? user.createdAt,
    remainingDays: remainingAccessDays(user.accessExpiresAt),
    sessionState: user.active && !user.accessRevokedAt ? "ACTIVE" : "INVALIDATED",
  };
}

async function targetAccessUser() {
  return prisma.user.findUnique({
    where: { email: OPERATIONS_DIRECTOR_EMAIL },
    select: userAccessSelect,
  });
}

export async function grantOperationsDirectorAccess(actor: OperationsActor) {
  assertDirector(actor);
  const temporaryPassword = generateTemporaryPassword();
  const password = await bcrypt.hash(temporaryPassword, 12);
  const expiresAt = accessExpiry();
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({
      where: { email: OPERATIONS_DIRECTOR_EMAIL },
      select: userAccessSelect,
    });
    if (existing && existing.companyId !== 1)
      throw new OperationsError("ACCOUNT_IN_OTHER_TENANT");
    const before = existing ? accessSnapshot(existing) : Prisma.JsonNull;
    const user = existing
      ? await tx.user.update({
          where: { id: existing.id },
          data: {
            name: OPERATIONS_DIRECTOR_NAME,
            email: OPERATIONS_DIRECTOR_EMAIL,
            password,
            role: Role.OPERATIONS_DIRECTOR,
            active: true,
            temporaryAccess: true,
            accessExpiresAt: expiresAt,
            accessRevokedAt: null,
            revokedById: null,
            revokeReason: null,
            ordaProjectOperationsEnabled: true,
            companyOperationsEnabled: true,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
            sessionVersion: { increment: 1 },
          },
          select: userAccessSelect,
        })
      : await tx.user.create({
          data: {
            companyId: 1,
            name: OPERATIONS_DIRECTOR_NAME,
            email: OPERATIONS_DIRECTOR_EMAIL,
            password,
            role: Role.OPERATIONS_DIRECTOR,
            active: true,
            temporaryAccess: true,
            accessExpiresAt: expiresAt,
            ordaProjectOperationsEnabled: true,
            companyOperationsEnabled: true,
            mustChangePassword: false,
            passwordChangedAt: new Date(),
          },
          select: userAccessSelect,
        });
    await tx.operationalAccessAuditEvent.create({
      data: {
        companyId: 1,
        targetUserId: user.id,
        actorId: actor.userId,
        action: OperationalAccessAuditAction.OPERATIONAL_ACCESS_GRANTED,
        before,
        after: accessSnapshot(user),
        reason: "Временный операционный доступ на 30 дней",
      },
    });
    return user;
  });
  return { user: accessDto(result, new Date()), temporaryPassword };
}

export async function extendOperationsDirectorAccess(actor: OperationsActor) {
  assertDirector(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: OPERATIONS_DIRECTOR_EMAIL }, select: userAccessSelect });
    if (!existing || existing.role !== Role.OPERATIONS_DIRECTOR)
      throw new OperationsError("OPERATOR_NOT_FOUND");
    const base = existing.accessExpiresAt && existing.accessExpiresAt > new Date()
      ? existing.accessExpiresAt
      : new Date();
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        active: true,
        temporaryAccess: true,
        accessExpiresAt: accessExpiry(base),
        accessRevokedAt: null,
        revokedById: null,
        revokeReason: null,
        sessionVersion: { increment: 1 },
      },
      select: userAccessSelect,
    });
    await tx.operationalAccessAuditEvent.create({ data: {
      companyId: 1, targetUserId: user.id, actorId: actor.userId,
      action: OperationalAccessAuditAction.OPERATIONAL_ACCESS_EXTENDED,
      before: accessSnapshot(existing), after: accessSnapshot(user),
      reason: "Операционный доступ продлён на 30 дней",
    } });
    return accessDto(user);
  });
}

export async function setOperationsScope(
  actor: OperationsActor,
  scope: OperationalScope,
  enabled: boolean,
) {
  assertDirector(actor);
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: OPERATIONS_DIRECTOR_EMAIL }, select: userAccessSelect });
    if (!existing || existing.role !== Role.OPERATIONS_DIRECTOR)
      throw new OperationsError("OPERATOR_NOT_FOUND");
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        ...(scope === OperationalScope.ORDA_PROJECT
          ? { ordaProjectOperationsEnabled: enabled }
          : { companyOperationsEnabled: enabled }),
        sessionVersion: { increment: 1 },
      },
      select: userAccessSelect,
    });
    await tx.operationalAccessAuditEvent.create({ data: {
      companyId: 1, targetUserId: user.id, actorId: actor.userId,
      action: OperationalAccessAuditAction.OPERATIONAL_SCOPE_CHANGED,
      before: accessSnapshot(existing), after: accessSnapshot(user),
      reason: `${scope}: ${enabled ? "включено" : "отключено"}`,
    } });
    return accessDto(user);
  });
}

export async function revokeOperationsDirectorAccess(actor: OperationsActor, reason: string) {
  assertDirector(actor);
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 5 || normalizedReason.length > 500)
    throw new OperationsError("REASON_REQUIRED");
  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email: OPERATIONS_DIRECTOR_EMAIL }, select: userAccessSelect });
    if (!existing || existing.role !== Role.OPERATIONS_DIRECTOR)
      throw new OperationsError("OPERATOR_NOT_FOUND");
    const [workItems, calendarTasks] = await Promise.all([
      tx.operationalWorkItem.updateMany({
        where: { assigneeId: existing.id, status: { in: unfinishedWorkStatuses } },
        data: { assigneeId: actor.userId },
      }),
      tx.calendarTask.updateMany({
        where: {
          assigneeId: existing.id,
          status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] },
        },
        data: { assigneeId: actor.userId },
      }),
    ]);
    const user = await tx.user.update({
      where: { id: existing.id },
      data: {
        active: false,
        accessRevokedAt: new Date(),
        revokedById: actor.userId,
        revokeReason: normalizedReason,
        ordaProjectOperationsEnabled: false,
        companyOperationsEnabled: false,
        sessionVersion: { increment: 1 },
      },
      select: userAccessSelect,
    });
    await tx.operationalAccessAuditEvent.create({ data: {
      companyId: 1, targetUserId: user.id, actorId: actor.userId,
      action: OperationalAccessAuditAction.OPERATIONAL_ACCESS_REVOKED,
      before: accessSnapshot(existing),
      after: { ...accessSnapshot(user), reassignedWorkItems: workItems.count, reassignedCalendarTasks: calendarTasks.count },
      reason: normalizedReason,
    } });
    return { user: accessDto(user), reassignedWorkItems: workItems.count, reassignedCalendarTasks: calendarTasks.count };
  }, { maxWait: 10_000, timeout: 30_000 });
}

const workItemSelect = {
  id: true,
  scope: true,
  title: true,
  description: true,
  source: true,
  status: true,
  priority: true,
  dueAt: true,
  completedAt: true,
  previewUrl: true,
  productionUrl: true,
  commitSha: true,
  pullRequestUrl: true,
  verificationResult: true,
  releaseStatus: true,
  createdAt: true,
  updatedAt: true,
  assignee: { select: { id: true, name: true, role: true, active: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.OperationalWorkItemSelect;

export async function createOperationalWorkItem(
  actor: OperationsActor,
  input: Record<string, unknown>,
) {
  const scope = input.scope as OperationalScope;
  if (!Object.values(OperationalScope).includes(scope)) throw new OperationsError("INVALID_SCOPE");
  assertOperationalScope(actor, scope);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const source = typeof input.source === "string" ? input.source.trim() : "";
  if (!title || title.length > 200 || !source || source.length > 120)
    throw new OperationsError("INVALID_WORK_ITEM");
  const assigneeId = Number(input.assigneeId ?? actor.userId);
  const assignee = await prisma.user.findFirst({ where: { id: assigneeId, active: true }, select: { id: true } });
  if (!assignee) throw new OperationsError("ASSIGNEE_NOT_FOUND");
  const dueAt = input.dueAt ? new Date(String(input.dueAt)) : null;
  if (dueAt && Number.isNaN(dueAt.getTime())) throw new OperationsError("INVALID_DATE");
  const priority = input.priority as OperationalWorkItemPriority;
  if (!Object.values(OperationalWorkItemPriority).includes(priority)) throw new OperationsError("INVALID_PRIORITY");
  return prisma.$transaction(async (tx) => {
    const item = await tx.operationalWorkItem.create({ data: {
      scope, title,
      description: typeof input.description === "string" ? input.description.trim().slice(0, 5000) || null : null,
      source, priority, dueAt, assigneeId, createdById: actor.userId,
      previewUrl: operationalUrl(input.previewUrl),
      productionUrl: operationalUrl(input.productionUrl),
      commitSha: typeof input.commitSha === "string" ? input.commitSha.trim().slice(0, 64) || null : null,
      pullRequestUrl: operationalUrl(input.pullRequestUrl),
      verificationResult: typeof input.verificationResult === "string" ? input.verificationResult.trim().slice(0, 2000) || null : null,
      releaseStatus: typeof input.releaseStatus === "string" ? input.releaseStatus.trim().slice(0, 100) || null : null,
    }, select: workItemSelect });
    await tx.operationalAccessAuditEvent.create({ data: {
      targetUserId: assigneeId, actorId: actor.userId,
      action: OperationalAccessAuditAction.OPERATIONAL_TASK_CREATED,
      after: { workItemId: item.id, scope, status: item.status, assigneeId },
      reason: `Создана задача: ${title}`,
    } });
    return item;
  });
}

export async function updateOperationalWorkItem(
  actor: OperationsActor,
  id: number,
  input: Record<string, unknown>,
) {
  const existing = await prisma.operationalWorkItem.findUnique({ where: { id }, select: { id: true, scope: true, status: true, assigneeId: true, title: true } });
  if (!existing) throw new OperationsError("WORK_ITEM_NOT_FOUND");
  assertOperationalScope(actor, existing.scope);
  const status = input.status === undefined ? existing.status : input.status as OperationalWorkItemStatus;
  if (!Object.values(OperationalWorkItemStatus).includes(status)) throw new OperationsError("INVALID_STATUS");
  const assigneeId = input.assigneeId === undefined ? existing.assigneeId : Number(input.assigneeId);
  const assignee = await prisma.user.findFirst({ where: { id: assigneeId, active: true }, select: { id: true } });
  if (!assignee) throw new OperationsError("ASSIGNEE_NOT_FOUND");
  const dueAt = input.dueAt === undefined ? undefined : input.dueAt ? new Date(String(input.dueAt)) : null;
  if (dueAt instanceof Date && Number.isNaN(dueAt.getTime())) throw new OperationsError("INVALID_DATE");
  const title = input.title === undefined ? undefined : typeof input.title === "string" ? input.title.trim() : "";
  if (title === "" || (title && title.length > 200)) throw new OperationsError("INVALID_WORK_ITEM");
  const source = input.source === undefined ? undefined : typeof input.source === "string" ? input.source.trim() : "";
  if (source === "" || (source && source.length > 120)) throw new OperationsError("INVALID_WORK_ITEM");
  const priority = input.priority === undefined
    ? undefined
    : input.priority as OperationalWorkItemPriority;
  if (priority !== undefined && !Object.values(OperationalWorkItemPriority).includes(priority))
    throw new OperationsError("INVALID_PRIORITY");
  const action = input.action === "approve-release"
    ? OperationalAccessAuditAction.OPERATIONAL_RELEASE_APPROVED
    : assigneeId !== existing.assigneeId
      ? OperationalAccessAuditAction.OPERATIONAL_TASK_ASSIGNED
      : OperationalAccessAuditAction.OPERATIONAL_TASK_UPDATED;
  if (action === OperationalAccessAuditAction.OPERATIONAL_RELEASE_APPROVED && existing.scope !== OperationalScope.ORDA_PROJECT)
    throw new OperationsError("INVALID_RELEASE_SCOPE");
  if (action === OperationalAccessAuditAction.OPERATIONAL_RELEASE_APPROVED && status !== OperationalWorkItemStatus.COMPLETED)
    throw new OperationsError("RELEASE_NOT_COMPLETED");
  return prisma.$transaction(async (tx) => {
    const item = await tx.operationalWorkItem.update({ where: { id }, data: {
      ...(title !== undefined ? { title } : {}),
      ...(input.description !== undefined ? { description: typeof input.description === "string" ? input.description.trim().slice(0, 5000) || null : null } : {}),
      ...(source !== undefined ? { source } : {}),
      ...(priority !== undefined ? { priority } : {}),
      ...(dueAt !== undefined ? { dueAt } : {}),
      status,
      assigneeId,
      completedAt: status === OperationalWorkItemStatus.COMPLETED ? new Date() : null,
      ...(input.previewUrl !== undefined ? { previewUrl: operationalUrl(input.previewUrl) } : {}),
      ...(input.productionUrl !== undefined ? { productionUrl: operationalUrl(input.productionUrl) } : {}),
      ...(input.commitSha !== undefined ? { commitSha: String(input.commitSha).trim().slice(0, 64) || null } : {}),
      ...(input.pullRequestUrl !== undefined ? { pullRequestUrl: operationalUrl(input.pullRequestUrl) } : {}),
      ...(input.verificationResult !== undefined ? { verificationResult: String(input.verificationResult).trim().slice(0, 2000) || null } : {}),
      ...(input.releaseStatus !== undefined || input.action === "approve-release" ? { releaseStatus: input.action === "approve-release" ? "APPROVED" : String(input.releaseStatus).trim().slice(0, 100) || null } : {}),
    }, select: workItemSelect });
    await tx.operationalAccessAuditEvent.create({ data: {
      targetUserId: assigneeId, actorId: actor.userId, action,
      before: { workItemId: id, status: existing.status, assigneeId: existing.assigneeId },
      after: { workItemId: id, status: item.status, assigneeId },
      reason: action === OperationalAccessAuditAction.OPERATIONAL_RELEASE_APPROVED ? "Релиз проверен и одобрен" : `Обновлена задача: ${item.title}`,
    } });
    return item;
  });
}

function money(value: Prisma.Decimal.Value | null | undefined) {
  return Number(value ?? 0);
}

async function operationalFinanceAndPayroll() {
  const profitability = await getCompanyProfitability();
  const [accruals, payments, pendingOrderAccruals] = await Promise.all([
    prisma.payrollAccrual.findMany({ select: { amount: true, direction: true, orderId: true } }),
    prisma.payrollPayment.findMany({ where: { reversedAt: null }, select: { amount: true, type: true } }),
    prisma.payrollAccrual.count({ where: { orderId: { not: null }, payments: { none: { reversedAt: null } } } }),
  ]);
  const totalAccrued = accruals.reduce((sum, row) => sum + (row.direction === PayrollDirection.INCREASE ? money(row.amount) : -money(row.amount)), 0);
  const totalPaid = payments.reduce((sum, row) => sum + (row.type === PayrollPaymentType.EMPLOYEE_REFUND ? -money(row.amount) : money(row.amount)), 0);
  return {
    finance: {
      sales: money(profitability.totals.sales),
      grossMargin: money(profitability.totals.grossMargin),
      netProfit: money(profitability.totals.companyNetProfit),
      clientOutstanding: money(profitability.totals.clientOutstanding),
      partnerPayable: money(profitability.totals.partnerPayable),
      expensesByCategory: profitability.charts.expenses.map((row) => ({ name: row.name, amount: money(row.amount) })),
      calculatedOrders: profitability.totals.calculatedOrders,
      incompleteOrders: profitability.totals.incompleteOrders,
    },
    payroll: {
      orderAccrued: accruals.filter((row) => row.orderId !== null).reduce((sum, row) => sum + (row.direction === PayrollDirection.INCREASE ? money(row.amount) : -money(row.amount)), 0),
      pendingOrderAccruals,
      companyDebt: Math.max(0, totalAccrued - totalPaid),
    },
  };
}

async function companyOperationsProjection() {
  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const orderBrief = { id: true, number: true, lifecycle: true, promisedAt: true, productionDeadline: true, partnerId: true, partnerPrice: true, balance: true, client: { select: { id: true, name: true, city: true } }, managerUser: { select: { id: true, name: true, active: true } } } satisfies Prisma.OrderSelect;
  const [unassignedLeads, incompleteOrders, overdueOrders, ordersWithoutContracts, ordersWithoutWorkshop, ordersWithoutWorkshopPrice, awaitingPayment, completedObjects, content, managerTasks, activeManagers, morningReviews, problemMeasurements, production, complaints] = await Promise.all([
    prisma.client.findMany({ where: { active: true, deletedAt: null, managerUserId: null }, take: 100, orderBy: { createdAt: "desc" }, select: { id: true, name: true, city: true, createdAt: true } }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] }, OR: [{ address: "" }, { material: "" }, { staircase: "" }, { managerUserId: null }, { amount: { lte: 0 } }] }, take: 100, orderBy: { updatedAt: "desc" }, select: orderBrief }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { notIn: [OrderLifecycle.COMPLETED, OrderLifecycle.CANCELLED] }, OR: [{ promisedAt: { lt: now } }, { productionDeadline: { lt: now } }] }, take: 100, orderBy: { productionDeadline: "asc" }, select: orderBrief }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED }, documents: { none: { type: DocumentType.CONTRACT, status: { notIn: [DocumentStatus.ARCHIVED, DocumentStatus.CANCELLED] } } } }, take: 100, orderBy: { createdAt: "desc" }, select: orderBrief }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED }, partnerId: null }, take: 100, orderBy: { createdAt: "desc" }, select: orderBrief }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED }, partnerId: { not: null }, OR: [{ partnerAgreedAt: null }, { partnerPrice: { lte: 0 } }] }, take: 100, orderBy: { createdAt: "desc" }, select: orderBrief }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED }, balance: { gt: 0 } }, take: 100, orderBy: { createdAt: "desc" }, select: orderBrief }),
    prisma.order.findMany({ where: { deletedAt: null, lifecycle: OrderLifecycle.COMPLETED }, take: 100, orderBy: { completedAt: "desc" }, select: orderBrief }),
    prisma.marketingContentTask.findMany({ where: { status: { notIn: ["PUBLISHED", "REFUSED"] } }, take: 100, orderBy: { updatedAt: "desc" }, select: { id: true, status: true, scheduledAt: true, order: { select: { id: true, number: true } }, assignedMarketer: { select: { id: true, name: true } } } }),
    prisma.calendarTask.findMany({ where: { status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] }, assignee: { active: true, role: Role.MANAGER } }, take: 100, orderBy: { dueAt: "asc" }, select: { id: true, title: true, dueAt: true, priority: true, assignee: { select: { id: true, name: true } }, order: { select: { id: true, number: true } }, client: { select: { id: true, name: true } } } }),
    prisma.user.findMany({ where: { active: true, role: Role.MANAGER }, select: { id: true, name: true } }),
    prisma.managerDailyReview.findMany({ where: { businessDate: { gte: dayStart, lt: dayEnd } }, select: { managerUserId: true, completedAt: true, inventoryOrderCount: true, actionOrderCount: true, manager: { select: { name: true, active: true } } } }),
    prisma.measurement.findMany({ where: { OR: [{ status: { in: [MeasurementStatus.ASSIGNED, MeasurementStatus.IN_PROGRESS] }, visitDate: { lt: now } }, { status: MeasurementStatus.COMPLETED, handedAt: null }] }, take: 100, orderBy: { visitDate: "asc" }, select: { id: true, status: true, visitDate: true, client: { select: { id: true, name: true } }, measurerUser: { select: { id: true, name: true, active: true } } } }),
    prisma.production.groupBy({ by: ["stage"], where: { archivedAt: null, completedAt: null, order: { deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } } }, _count: { _all: true }, _min: { plannedEndAt: true } }),
    prisma.operationalWorkItem.findMany({ where: { scope: OperationalScope.ALTYN_SAPA, source: "EMPLOYEE_COMPLAINT", status: { in: unfinishedWorkStatuses } }, select: workItemSelect, orderBy: [{ priority: "desc" }, { createdAt: "desc" }] }),
  ]);
  const reviewed = new Set(morningReviews.filter((row) => row.manager.active).map((row) => row.managerUserId));
  return {
    unassignedLeads,
    incompleteOrders,
    overdueOrders,
    ordersWithoutContracts,
    ordersWithoutWorkshop,
    ordersWithoutWorkshopPrice,
    awaitingPayment,
    completedObjects,
    content,
    managerTasks,
    managerMorningControl: {
      activeManagers: activeManagers.length,
      completed: reviewed.size,
      missing: activeManagers.filter((manager) => !reviewed.has(manager.id)),
      reviews: morningReviews,
    },
    problemMeasurements,
    production,
    complaints,
  };
}

export async function getOperationsDashboard(actor: OperationsActor) {
  assertLiveOperationsTenant();
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.OPERATIONS_DIRECTOR)
    throw new OperationsError("FORBIDDEN");
  const target = actor.role === Role.DIRECTOR ? await targetAccessUser() : await prisma.user.findUnique({ where: { id: actor.userId }, select: userAccessSelect });
  const grant = target ? await prisma.operationalAccessAuditEvent.findFirst({ where: { targetUserId: target.id, action: OperationalAccessAuditAction.OPERATIONAL_ACCESS_GRANTED }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }) : null;
  const [tasks, audits, employees] = await Promise.all([
    prisma.operationalWorkItem.findMany({ orderBy: [{ status: "asc" }, { priority: "desc" }, { dueAt: "asc" }], select: workItemSelect }),
    target ? prisma.operationalAccessAuditEvent.findMany({ where: { targetUserId: target.id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, reason: true, createdAt: true, actor: { select: { id: true, name: true } } } }) : Promise.resolve([]),
    prisma.user.findMany({ where: { active: true, role: { not: Role.PARTNER } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
  ]);
  const ordaEnabled = scopeEnabled(actor, OperationalScope.ORDA_PROJECT);
  const companyEnabled = scopeEnabled(actor, OperationalScope.ALTYN_SAPA);
  const [company, financeAndPayroll] = companyEnabled
    ? await Promise.all([companyOperationsProjection(), operationalFinanceAndPayroll()])
    : [null, null];
  return {
    viewer: { role: actor.role, ordaProjectOperationsEnabled: ordaEnabled, companyOperationsEnabled: companyEnabled },
    access: accessDto(target, grant?.createdAt),
    employees,
    audits,
    project: ordaEnabled ? { tasks: tasks.filter((item) => item.scope === OperationalScope.ORDA_PROJECT) } : null,
    company: companyEnabled ? { ...company, tasks: tasks.filter((item) => item.scope === OperationalScope.ALTYN_SAPA), ...financeAndPayroll } : null,
  };
}
