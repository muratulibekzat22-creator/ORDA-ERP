import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { canCreateCalendarEvent, canManageCalendarEvent, isScopedCalendarRole } from "@/lib/calendar-access";
import { prisma } from "@/lib/prisma";
import { createCalendarEvent, getCalendarData, getCalendarEvent, moveCalendarEvent } from "@/lib/services/calendar.service";
import { requirePermission } from "@/lib/server-auth";

const toDate = (value: unknown) => { const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? null : date; };

export async function GET(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  const userId = Number(auth.session!.user.id);
  const requestedId = Number(new URL(request.url).searchParams.get("assignedUserId"));
  const assignedUserId = isScopedCalendarRole(role) ? userId : Number.isInteger(requestedId) && requestedId > 0 ? requestedId : undefined;
  return NextResponse.json(await getCalendarData({ role, userId, assignedUserId, viewerName: auth.session!.user.name }));
}

export async function POST(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const startDate = toDate(body.startDate), orderId = Number(body.orderId), assignedUserId = Number(body.assignedUserId);
    if (!startDate || !Number.isInteger(orderId) || !Number.isInteger(assignedUserId) || (body.sourceType !== "measurement" && body.sourceType !== "production")) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    const role = auth.session!.user.role as Role, userId = Number(auth.session!.user.id);
    const stage = typeof body.stage === "string" ? body.stage : undefined;
    if (!canCreateCalendarEvent(role, userId, { sourceType: body.sourceType, assignedUserId, stage })) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    const result = await createCalendarEvent({ sourceType: body.sourceType, orderId, startDate, assignedUserId, stage, comment: typeof body.comment === "string" ? body.comment : undefined, user: auth.session!.user.name ?? "Система" });
    return result ? NextResponse.json(result, { status: 201 }) : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  } catch (error) {
    console.error(error); return NextResponse.json({ error: "Недопустимый исполнитель" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const body = await request.json() as Record<string, unknown>, startDate = toDate(body.startDate), id = Number(body.id);
  if (!startDate || !Number.isInteger(id) || (body.sourceType !== "measurement" && body.sourceType !== "production")) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const sourceType = body.sourceType as "measurement" | "production";
  const current = await getCalendarEvent(sourceType, id);
  if (!current) return NextResponse.json({ error: "Событие не найдено" }, { status: 404 });
  const role = auth.session!.user.role as Role, userId = Number(auth.session!.user.id);
  const event = "measurerUserId" in current
    ? { sourceType, assignedUserId: current.measurerUserId }
    : { sourceType, assignedUserId: current.masterUserId, stage: current.stage };
  if (!canManageCalendarEvent(role, userId, event)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try { return NextResponse.json(await moveCalendarEvent({ sourceType, id, startDate, user: auth.session!.user.name ?? "Система" })); }
  catch { return NextResponse.json({ error: "Событие не найдено" }, { status: 404 }); }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const { searchParams } = new URL(request.url);
  const id = Number(searchParams.get("id"));
  const sourceType = searchParams.get("sourceType");
  if (!Number.isInteger(id) || id <= 0 || (sourceType !== "measurement" && sourceType !== "production")) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  const current = await getCalendarEvent(sourceType, id);
  if (!current) return NextResponse.json({ error: "Событие не найдено" }, { status: 404 });
  const role = auth.session!.user.role as Role, userId = Number(auth.session!.user.id);
  const event = "measurerUserId" in current ? { sourceType: sourceType as "measurement", assignedUserId: current.measurerUserId } : { sourceType: sourceType as "production", assignedUserId: current.masterUserId, stage: current.stage };
  if (!canManageCalendarEvent(role, userId, event)) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  await prisma.$transaction(async (tx) => {
    const orderId = current.orderId;
    if (sourceType === "measurement") await tx.measurement.delete({ where: { id } });
    else await tx.production.delete({ where: { id } });
    await tx.orderEvent.create({ data: { orderId, title: "Событие календаря удалено", user: auth.session!.user.name ?? "Система" } });
  });
  return NextResponse.json({ ok: true });
}
