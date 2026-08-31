import { CalendarTaskPriority, CalendarTaskStatus, CalendarTaskType, Prisma, Role } from "@prisma/client";
import { decodeDateIdCursor, encodeDateIdCursor } from "@/lib/pagination/date-id-cursor";
import { prisma } from "@/lib/prisma";

export type CalendarActor = { userId: number; role: Role; name: string };
export type CalendarTaskInput = { title: string; description?: string | null; type: CalendarTaskType; dueAt: Date; priority: CalendarTaskPriority; assigneeId: number; clientId?: number | null; orderId?: number | null };

const taskSelect = {
  id: true, title: true, description: true, type: true, dueAt: true, status: true, priority: true,
  assigneeId: true, creatorId: true, completedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
  assignee: { select: { id: true, name: true, role: true } }, creator: { select: { id: true, name: true } },
  client: { select: { id: true, name: true, phone: true, whatsapp: true, city: true } },
  order: { select: { id: true, number: true, managerUserId: true, manager: true, client: { select: { id: true, name: true } } } },
} satisfies Prisma.CalendarTaskSelect;

export function taskScope(actor: CalendarActor): Prisma.CalendarTaskWhereInput {
  if (actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR) return {};
  if (actor.role === Role.MANAGER) return { OR: [{ assigneeId: actor.userId }, { creatorId: actor.userId }, { client: { managerUserId: actor.userId } }, { order: { managerUserId: actor.userId } }] };
  return { assigneeId: actor.userId };
}

function activeTaskScope(): Prisma.CalendarTaskWhereInput {
  return {
    OR: [
      { orderId: null },
      { order: { deletedAt: null } },
      { measurement: { client: { active: true, deletedAt: null } } },
    ],
  };
}

export function canAssign(actor: CalendarActor, assigneeId: number) {
  return actor.role === Role.DIRECTOR || actor.role === Role.MANAGER || actor.userId === assigneeId;
}

async function validateRelations(tx: Prisma.TransactionClient, actor: CalendarActor, input: CalendarTaskInput) {
  const assignee = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { id: true, active: true } });
  if (!assignee?.active || !canAssign(actor, input.assigneeId)) throw new Error("INVALID_ASSIGNEE");
  if (input.clientId) {
    const client = await tx.client.findFirst({ where: { id: input.clientId, active: true, deletedAt: null }, select: { managerUserId: true } });
    if (!client) throw new Error("CLIENT_NOT_FOUND");
    if (actor.role === Role.MANAGER && client.managerUserId !== actor.userId) throw new Error("FORBIDDEN_RELATION");
  }
  if (input.orderId) {
    const order = await tx.order.findFirst({ where: { id: input.orderId, deletedAt: null }, select: { clientId: true, managerUserId: true, manager: true } });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (input.clientId && order.clientId !== input.clientId) throw new Error("RELATION_MISMATCH");
    if (actor.role === Role.MANAGER && order.managerUserId !== actor.userId && order.manager !== actor.name) throw new Error("FORBIDDEN_RELATION");
  }
}

export type CalendarListFilters = {
  from: Date;
  to: Date;
  assigneeId?: number;
  assigneeRole?: Role;
  state?: string;
  status?: CalendarTaskStatus;
  type?: CalendarTaskType;
  cursor?: string;
  limit?: number;
};

export async function listCalendarTasks(actor: CalendarActor, filters: CalendarListFilters) {
  const limit = Math.min(500, Math.max(1, Math.trunc(filters.limit ?? 200)));
  const cursor = decodeDateIdCursor(filters.cursor);
  if (filters.cursor && !cursor) throw new Error("INVALID_CURSOR");
  const where: Prisma.CalendarTaskWhereInput = { AND: [taskScope(actor), activeTaskScope()], dueAt: { gte: filters.from, lt: filters.to } };
  if (filters.assigneeId) where.assigneeId = actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR ? filters.assigneeId : actor.userId;
  if (filters.status) where.status = filters.status;
  else if (filters.state === "completed") where.status = CalendarTaskStatus.COMPLETED;
  else if (filters.state === "active") where.status = { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] };
  else if (filters.state === "overdue") { where.status = { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] }; where.dueAt = { gte: filters.from, lt: new Date(Math.min(filters.to.getTime(), Date.now())) }; }
  if (filters.type) where.type = filters.type;
  if (filters.assigneeRole) where.assignee = { role: filters.assigneeRole, active: true };
  if (cursor) {
    where.AND = [
      ...(Array.isArray(where.AND) ? where.AND : [taskScope(actor), activeTaskScope()]),
      { OR: [{ dueAt: { gt: cursor.at } }, { dueAt: cursor.at, id: { gt: cursor.id } }] },
    ];
  }
  const rows = await prisma.calendarTask.findMany({ where, select: taskSelect, orderBy: [{ dueAt: "asc" }, { id: "asc" }], take: limit + 1 });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);
  return {
    tasks: page.map((task) => ({ ...task, overdue: task.dueAt < new Date() && task.status !== CalendarTaskStatus.COMPLETED && task.status !== CalendarTaskStatus.CANCELLED })),
    pagination: {
      limit,
      hasMore,
      nextCursor: hasMore && last ? encodeDateIdCursor(last.dueAt, last.id) : null,
    },
  };
}

export async function getCalendarTask(actor: CalendarActor, id: number) {
  return prisma.calendarTask.findFirst({ where: { id, AND: [taskScope(actor), activeTaskScope()] }, select: { ...taskSelect, auditEvents: { orderBy: { createdAt: "desc" }, take: 20, select: { id: true, action: true, before: true, after: true, createdAt: true, actor: { select: { id: true, name: true } } } } } });
}

export async function getCalendarMeta(actor: CalendarActor) {
  const fullRead = actor.role === Role.DIRECTOR || actor.role === Role.OPERATIONS_DIRECTOR;
  const userWhere = fullRead ? { active: true } : { id: actor.userId, active: true };
  const orderWhere: Prisma.OrderWhereInput = { deletedAt: null, ...(fullRead ? {} : actor.role === Role.MANAGER ? { OR: [{ managerUserId: actor.userId }, { managerUserId: null, manager: actor.name }] } : { id: -1 }) };
  const clientWhere: Prisma.ClientWhereInput = { active: true, deletedAt: null, ...(fullRead ? {} : actor.role === Role.MANAGER ? { managerUserId: actor.userId } : { id: -1 }) };
  const [assignees, clients, orders] = await Promise.all([
    prisma.user.findMany({ where: userWhere, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } }),
    prisma.client.findMany({ where: clientWhere, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" }, take: 300 }),
    prisma.order.findMany({ where: orderWhere, select: { id: true, number: true, clientId: true, client: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  return { assignees, clients, orders };
}

export async function createCalendarTask(actor: CalendarActor, input: CalendarTaskInput) {
  return prisma.$transaction(async (tx) => {
    await validateRelations(tx, actor, input);
    const conflict = await tx.calendarTask.findFirst({ where: { assigneeId: input.assigneeId, dueAt: input.dueAt, status: { in: [CalendarTaskStatus.PLANNED, CalendarTaskStatus.IN_PROGRESS] } }, select: { id: true, title: true } });
    const task = await tx.calendarTask.create({ data: { ...input, creatorId: actor.userId }, select: taskSelect });
    await tx.calendarTaskAudit.create({ data: { taskId: task.id, action: "CREATED", actorId: actor.userId, after: { dueAt: input.dueAt, assigneeId: input.assigneeId, status: CalendarTaskStatus.PLANNED } } });
    return { task, conflict };
  });
}

export async function updateCalendarTask(actor: CalendarActor, id: number, input: CalendarTaskInput) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.calendarTask.findFirst({ where: { id, AND: [taskScope(actor), activeTaskScope()] }, select: { id: true, dueAt: true, assigneeId: true, status: true } });
    if (!current) throw new Error("NOT_FOUND");
    if (current.status === CalendarTaskStatus.COMPLETED || current.status === CalendarTaskStatus.CANCELLED) throw new Error("TERMINAL_TASK");
    await validateRelations(tx, actor, input);
    const task = await tx.calendarTask.update({ where: { id }, data: input, select: taskSelect });
    const action = current.assigneeId !== input.assigneeId ? "REASSIGNED" : current.dueAt.getTime() !== input.dueAt.getTime() ? "RESCHEDULED" : "UPDATED";
    await tx.calendarTaskAudit.create({ data: { taskId: id, action, actorId: actor.userId, before: { dueAt: current.dueAt, assigneeId: current.assigneeId }, after: { dueAt: input.dueAt, assigneeId: input.assigneeId } } });
    return task;
  });
}

export async function setCalendarTaskState(actor: CalendarActor, id: number, action: "complete" | "cancel") {
  return prisma.$transaction(async (tx) => {
    const current = await tx.calendarTask.findFirst({ where: { id, AND: [taskScope(actor), activeTaskScope()] }, select: { id: true, status: true } });
    if (!current) throw new Error("NOT_FOUND");
    if (action === "cancel" && actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER && current.status !== CalendarTaskStatus.PLANNED) throw new Error("FORBIDDEN");
    const now = new Date();
    const task = await tx.calendarTask.update({ where: { id }, data: action === "complete" ? { status: CalendarTaskStatus.COMPLETED, completedAt: now, completedById: actor.userId, cancelledAt: null } : { status: CalendarTaskStatus.CANCELLED, cancelledAt: now, completedAt: null, completedById: null }, select: taskSelect });
    await tx.calendarTaskAudit.create({ data: { taskId: id, action: action === "complete" ? "COMPLETED" : "CANCELLED", actorId: actor.userId, before: { status: current.status }, after: { status: task.status } } });
    return task;
  });
}

// Backwards-compatible adapters for legacy Measurement/Production callers.
export async function createCalendarEvent(data: { sourceType: "measurement" | "production"; orderId: number; startDate: Date; assignedUserId: number; stage?: string; comment?: string; user: string }) {
  return prisma.$transaction(async (tx) => {
    const [order, user] = await Promise.all([tx.order.findFirst({ where: { id: data.orderId, deletedAt: null }, select: { id: true, clientId: true } }), tx.user.findUnique({ where: { id: data.assignedUserId }, select: { id: true, name: true, active: true } })]);
    if (!order) return null;
    if (!user?.active) throw new Error("INVALID_ASSIGNEE");
    if (data.sourceType === "measurement") {
      const item = await tx.measurement.create({ data: { orderId: order.id, clientId: order.clientId, measurerUserId: user.id, measurer: user.name, visitDate: data.startDate, comment: data.comment } });
      await tx.orderEvent.create({ data: { orderId: order.id, title: "Назначен замер", user: data.user } });
      return item;
    }
    const item = await tx.production.create({ data: { orderId: order.id, stage: data.stage ?? "Подготовка", percent: 0, masterUserId: user.id, master: user.name, startDate: data.startDate, comment: data.comment } });
    await tx.orderEvent.create({ data: { orderId: order.id, title: "Запланирован этап", user: data.user } });
    return item;
  });
}

export async function moveCalendarEvent(data: { sourceType: "measurement" | "production"; id: number; startDate: Date; user: string }) {
  return prisma.$transaction(async (tx) => {
    const item = data.sourceType === "measurement" ? await tx.measurement.update({ where: { id: data.id }, data: { visitDate: data.startDate } }) : await tx.production.update({ where: { id: data.id }, data: { startDate: data.startDate } });
    if (item.orderId) await tx.orderEvent.create({ data: { orderId: item.orderId, title: "Событие перенесено", user: data.user } });
    return item;
  });
}
