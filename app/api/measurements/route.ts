import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseBusinessDateTime } from "@/lib/calendar-time";
import { measurementActor, measurementError } from "@/lib/measurement-api";
import { requirePermission } from "@/lib/server-auth";
import { prisma } from "@/lib/prisma";
import { listMeasurements, measurementWorkspace, scheduleMeasurement, type MeasurementWorkspaceFilter } from "@/lib/services/measurement.service";
import { selfScheduleMeasurement } from "@/lib/services/measurement.service";
import { normalizePhone } from "@/lib/leads/domain";

const positiveId = (value: unknown) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };
const workspaceFilters = new Set<MeasurementWorkspaceFilter>(["today", "upcoming", "needs-closing", "completed", "cancelled", "all"]);
const periodDate = (value: string | null, end = false) => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = parseBusinessDateTime(`${value}T00:00`);
  return date && end ? new Date(date.getTime() + 86_400_000) : date;
};

export async function GET(request: Request) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  const actor = measurementActor(auth.session!);
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER && actor.role !== Role.MEASURER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const url = new URL(request.url);
  if (url.searchParams.get("meta") === "1") {
    if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    const [measurers, managers] = await Promise.all([
      prisma.user.findMany({ where: { role: Role.MEASURER, active: true }, select: { id: true, name: true, phone: true }, orderBy: { name: "asc" } }),
      actor.role === Role.DIRECTOR
        ? prisma.user.findMany({ where: { role: Role.MANAGER, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } })
        : Promise.resolve([]),
    ]);
    return NextResponse.json({ measurers, managers });
  }
  if (url.searchParams.get("workspace") === "1") {
    const filterValue = url.searchParams.get("filter");
    const filter = filterValue && workspaceFilters.has(filterValue as MeasurementWorkspaceFilter)
      ? (filterValue as MeasurementWorkspaceFilter)
      : undefined;
    if (filterValue && !filter) return NextResponse.json({ error: "Некорректный фильтр" }, { status: 400 });
    const measurerUserId = positiveId(url.searchParams.get("measurerUserId"));
    const managerUserId = positiveId(url.searchParams.get("managerUserId"));
    const fromValue = url.searchParams.get("from"), toValue = url.searchParams.get("to");
    const from = periodDate(fromValue), to = periodDate(toValue, true);
    if ((fromValue && !from) || (toValue && !to)) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
    return NextResponse.json(await measurementWorkspace(actor, {
      filter,
      measurerUserId: measurerUserId ?? undefined,
      managerUserId: managerUserId ?? undefined,
      from: from ?? undefined,
      to: to ?? undefined,
    }));
  }
  const clientId = url.searchParams.has("clientId") ? positiveId(url.searchParams.get("clientId")) : undefined;
  const orderId = url.searchParams.has("orderId") ? positiveId(url.searchParams.get("orderId")) : undefined;
  if (url.searchParams.has("clientId") && !clientId) return NextResponse.json({ error: "Некорректный clientId" }, { status: 400 });
  if (url.searchParams.has("orderId") && !orderId) return NextResponse.json({ error: "Некорректный orderId" }, { status: 400 });
  return NextResponse.json(await listMeasurements(actor, { clientId: clientId ?? undefined, orderId: orderId ?? undefined }));
}

export async function POST(request: Request) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const actor = measurementActor(auth.session!);
    if (actor.role === Role.MEASURER && !body.clientId && !body.orderId) {
      const phone = normalizePhone(typeof body.phone === "string" ? body.phone : "");
      const visitDate = parseBusinessDateTime(body.visitDate);
      if (!phone || !visitDate) return NextResponse.json({ error: "Укажите корректные телефон, дату и время" }, { status: 400 });
      const result = await selfScheduleMeasurement(actor, { clientName: typeof body.clientName === "string" ? body.clientName : undefined, phone, city: typeof body.city === "string" ? body.city : "", visitDate, address: typeof body.address === "string" ? body.address : "", mapLink: typeof body.mapLink === "string" ? body.mapLink : undefined, comment: typeof body.comment === "string" ? body.comment : undefined });
      return NextResponse.json(result, { status: 201 });
    }
    const orderId = positiveId(body.orderId);
    const order = !body.clientId && orderId ? await prisma.order.findFirst({ where: { id: orderId, deletedAt: null }, select: { clientId: true } }) : null;
    const clientId = positiveId(body.clientId) ?? order?.clientId ?? null;
    let measurerUserId = positiveId(body.measurerUserId);
    if (!measurerUserId) {
      const activeMeasurers = await prisma.user.findMany({ where: { role: Role.MEASURER, active: true }, select: { id: true }, take: 2 });
      if (activeMeasurers.length === 0) return NextResponse.json({ error: "Нет активного замерщика" }, { status: 409 });
      if (activeMeasurers.length === 1) measurerUserId = activeMeasurers[0].id;
    }
    const visitDate = parseBusinessDateTime(body.visitDate) ?? (typeof body.visitDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.visitDate) ? parseBusinessDateTime(`${body.visitDate}T09:00`) : null);
    if (!clientId || !measurerUserId || !visitDate) return NextResponse.json({ error: "Укажите заявку, замерщика, дату и время" }, { status: 400 });
    const result = await scheduleMeasurement(actor, {
      clientId,
      orderId: orderId ?? undefined,
      measurerUserId,
      visitDate,
      city: typeof body.city === "string" ? body.city : undefined,
      address: typeof body.address === "string" ? body.address : undefined,
      mapLink: typeof body.mapLink === "string" ? body.mapLink : undefined,
      comment: typeof body.comment === "string" ? body.comment : undefined,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return error instanceof SyntaxError ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) : measurementError(error);
  }
}
