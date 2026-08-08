import { NextResponse } from "next/server";
import { calendarActor, calendarError, calendarInput } from "@/lib/calendar-api";
import { getCalendarTask, updateCalendarTask } from "@/lib/services/calendar.service";
import { requirePermission } from "@/lib/server-auth";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const id = Number((await context.params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный идентификатор" }, { status: 400 });
  const task = await getCalendarTask(calendarActor(auth.session!), id); return task ? NextResponse.json(task) : NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const id = Number((await context.params).id), parsed = calendarInput(await request.json() as Record<string, unknown>); if (!Number.isInteger(id) || id <= 0 || !parsed) return NextResponse.json({ error: "Проверьте данные" }, { status: 400 });
  try { return NextResponse.json(await updateCalendarTask(calendarActor(auth.session!), id, parsed)); } catch (error) { return calendarError(error); }
}
