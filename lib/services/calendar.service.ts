import { Prisma, Role } from "@prisma/client";

import { installationStage } from "@/lib/calendar-access";
import { prisma } from "@/lib/prisma";

export type CalendarEvent = {
  id: string;
  sourceType: "measurement" | "production";
  orderId: number;
  title: string;
  stage: string;
  startDate: Date;
  endDate: Date | null;
  assignedUserId: number | null;
  assignedUserName: string | null;
  legacyAssignedName: string;
  client: string;
  manager: string;
  partner: string | null;
  city: string;
};

type CalendarFilters = { role: Role; userId: number; assignedUserId?: number; viewerName?: string | null };

const productionStages = ["Новая заявка", "Замер", "Проектирование", "Заготовка", "Покраска", "Заказ готов", installationStage, "Сдано"];

function scopedWhere(role: Role, userId: number) {
  if (role === Role.MEASURER) return { measurements: { measurerUserId: userId }, productions: { id: -1 } };
  if (role === Role.PRODUCTION) return { measurements: { id: -1 }, productions: { masterUserId: userId } };
  if (role === Role.INSTALLER) return { measurements: { id: -1 }, productions: { masterUserId: userId, stage: installationStage } };
  return { measurements: undefined, productions: undefined };
}

export async function getCalendarData(filters: CalendarFilters) {
  const where = scopedWhere(filters.role, filters.userId);
  const [measurements, productions] = await Promise.all([
    prisma.measurement.findMany({ where: where.measurements, include: { measurerUser: true, order: { include: { client: true, partner: true } } } }),
    prisma.production.findMany({ where: where.productions, include: { masterUser: true, order: { include: { client: true, partner: true } } } }),
  ]);
  const events: CalendarEvent[] = [
    ...measurements.map((item) => ({ id: String(item.id), sourceType: "measurement" as const, orderId: item.orderId, title: "Замер", stage: "Замер", startDate: item.visitDate, endDate: null, assignedUserId: item.measurerUserId, assignedUserName: item.measurerUser?.name ?? null, legacyAssignedName: item.measurer, client: item.order.client.name, manager: item.order.manager, partner: item.order.partner?.name ?? null, city: item.order.client.city })),
    ...productions.filter((item) => item.startDate || item.finishDate).map((item) => ({ id: String(item.id), sourceType: "production" as const, orderId: item.orderId, title: item.stage, stage: item.stage, startDate: item.startDate ?? item.finishDate!, endDate: item.finishDate, assignedUserId: item.masterUserId, assignedUserName: item.masterUser?.name ?? null, legacyAssignedName: item.master, client: item.order.client.name, manager: item.order.manager, partner: item.order.partner?.name ?? null, city: item.order.client.city })),
  ];
  const filtered = events.filter((event) => !filters.assignedUserId || event.assignedUserId === filters.assignedUserId);
  const orders = filters.role === Role.DIRECTOR || filters.role === Role.MANAGER
    ? (await prisma.order.findMany({ select: { id: true, number: true, client: { select: { name: true } } }, orderBy: { createdAt: "desc" } })).map((order) => ({ id: order.id, number: order.number, client: order.client.name }))
    : [...new Map(filtered.map((event) => [event.orderId, { id: event.orderId, number: measurements.find((item) => item.orderId === event.orderId)?.order.number ?? productions.find((item) => item.orderId === event.orderId)?.order.number ?? "", client: filtered.find((candidate) => candidate.orderId === event.orderId)?.client ?? "" }])).values()];
  const assignees = [...new Map(filtered.filter((event) => event.assignedUserId).map((event) => [event.assignedUserId, { id: event.assignedUserId!, name: event.assignedUserName ?? event.legacyAssignedName }])).values()];
  if ((filters.role === Role.MEASURER || filters.role === Role.PRODUCTION || filters.role === Role.INSTALLER) && !assignees.some((item) => item.id === filters.userId)) assignees.push({ id: filters.userId, name: filters.viewerName ?? "Исполнитель" });
  return { events: filtered, orders, filters: { assignees } };
}

export async function getCalendarEvent(sourceType: "measurement" | "production", id: number) {
  if (sourceType === "measurement") return prisma.measurement.findUnique({ where: { id }, select: { id: true, orderId: true, measurerUserId: true } });
  return prisma.production.findUnique({ where: { id }, select: { id: true, orderId: true, masterUserId: true, stage: true } });
}

async function getAssignee(tx: Prisma.TransactionClient, id: number, measurement: boolean, stage?: string) {
  const user = await tx.user.findUnique({ where: { id } });
  const allowed: Role[] = measurement ? [Role.MEASURER, Role.DIRECTOR] : stage === installationStage ? [Role.INSTALLER, Role.DIRECTOR] : [Role.PRODUCTION, Role.DIRECTOR];
  if (!user || !user.active || !allowed.includes(user.role)) throw new Error("INVALID_ASSIGNEE");
  return user;
}

export async function createCalendarEvent(data: { sourceType: "measurement" | "production"; orderId: number; startDate: Date; assignedUserId: number; stage?: string; comment?: string; user: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: data.orderId } });
    if (!order) return null;
    if (data.sourceType === "measurement") {
      const user = await getAssignee(tx, data.assignedUserId, true);
      const item = await tx.measurement.create({ data: { orderId: order.id, measurerUserId: user.id, measurer: user.name, visitDate: data.startDate, comment: data.comment } });
      await tx.orderEvent.create({ data: { orderId: order.id, title: "Запланирован замер", user: data.user } });
      return item;
    }
    if (!data.stage || !productionStages.includes(data.stage)) throw new Error("INVALID_STAGE");
    const user = await getAssignee(tx, data.assignedUserId, false, data.stage);
    const item = await tx.production.create({ data: { orderId: order.id, stage: data.stage, percent: 0, masterUserId: user.id, master: user.name, startDate: data.startDate, comment: data.comment } });
    await tx.orderEvent.create({ data: { orderId: order.id, title: "Запланирован этап", user: data.user } });
    return item;
  });
}

export async function moveCalendarEvent(data: { sourceType: "measurement" | "production"; id: number; startDate: Date; user: string }) {
  return prisma.$transaction(async (tx) => {
    if (data.sourceType === "measurement") {
      const item = await tx.measurement.update({ where: { id: data.id }, data: { visitDate: data.startDate } });
      await tx.orderEvent.create({ data: { orderId: item.orderId, title: "Перенесён замер", user: data.user } });
      return item;
    }
    const item = await tx.production.update({ where: { id: data.id }, data: { startDate: data.startDate } });
    await tx.orderEvent.create({ data: { orderId: item.orderId, title: "Перенесён этап", user: data.user } });
    return item;
  });
}
