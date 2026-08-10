import { NextResponse } from "next/server";
import { CalendarTaskStatus, CalendarTaskType, Role } from "@prisma/client";
import { calendarActor, calendarError, calendarInput } from "@/lib/calendar-api";
import { createCalendarTask, getCalendarMeta, listCalendarTasks } from "@/lib/services/calendar.service";
import { requirePermission } from "@/lib/server-auth";

function date(value: string | null) { const result = value ? new Date(value) : null; return result && !Number.isNaN(result.getTime()) ? result : null; }

export async function GET(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const url = new URL(request.url);
  if (url.searchParams.get("meta") === "1") return NextResponse.json(await getCalendarMeta(calendarActor(auth.session!)));
  const now = new Date();
  const defaultFrom = new Date(now); defaultFrom.setHours(0, 0, 0, 0);
  const from = date(url.searchParams.get("start") ?? url.searchParams.get("from")) ?? defaultFrom;
  const to = date(url.searchParams.get("end") ?? url.searchParams.get("to")) ?? new Date(defaultFrom.getTime() + 86400000);
  if (!from || !to || from >= to || to.getTime() - from.getTime() > 62 * 86400000) return NextResponse.json({ error: "Укажите корректный диапазон не более 62 дней" }, { status: 400 });
  const requestedAssignee = Number(url.searchParams.get("assigneeId") ?? url.searchParams.get("assignedUserId"));
  const roleValue = url.searchParams.get("role");
  const statusValue = url.searchParams.get("status");
  const typeValue = url.searchParams.get("type");
  const limit = Number(url.searchParams.get("limit") ?? 200);
  if ((roleValue && !Object.values(Role).includes(roleValue as Role)) ||
      (statusValue && !Object.values(CalendarTaskStatus).includes(statusValue as CalendarTaskStatus)) ||
      (typeValue && !Object.values(CalendarTaskType).includes(typeValue as CalendarTaskType)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 500)
    return NextResponse.json({ error: "Некорректные фильтры календаря" }, { status: 400 });
  try {
    return NextResponse.json(await listCalendarTasks(calendarActor(auth.session!), {
      from,
      to,
      assigneeId: Number.isInteger(requestedAssignee) && requestedAssignee > 0 ? requestedAssignee : undefined,
      assigneeRole: roleValue as Role | undefined,
      state: url.searchParams.get("state") ?? undefined,
      status: statusValue as CalendarTaskStatus | undefined,
      type: typeValue as CalendarTaskType | undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
      limit,
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_CURSOR") return NextResponse.json({ error: "Некорректный cursor" }, { status: 400 });
    throw error;
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  try { const parsed = calendarInput(await request.json() as Record<string, unknown>); if (!parsed) return NextResponse.json({ error: "Проверьте обязательные поля" }, { status: 400 }); return NextResponse.json(await createCalendarTask(calendarActor(auth.session!), parsed), { status: 201 }); }
  catch (error) { return calendarError(error); }
}
