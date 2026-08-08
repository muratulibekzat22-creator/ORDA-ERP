import { NextResponse } from "next/server";
import { calendarActor, calendarError, calendarInput } from "@/lib/calendar-api";
import { createCalendarTask, getCalendarMeta, listCalendarTasks } from "@/lib/services/calendar.service";
import { requirePermission } from "@/lib/server-auth";

function date(value: string | null) { const result = value ? new Date(value) : null; return result && !Number.isNaN(result.getTime()) ? result : null; }

export async function GET(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  const url = new URL(request.url);
  if (url.searchParams.get("meta") === "1") return NextResponse.json(await getCalendarMeta(calendarActor(auth.session!)));
  const from = date(url.searchParams.get("from")), to = date(url.searchParams.get("to"));
  if (!from || !to || from >= to || to.getTime() - from.getTime() > 370 * 86400000) return NextResponse.json({ error: "Укажите корректный диапазон не более года" }, { status: 400 });
  const requestedAssignee = Number(url.searchParams.get("assigneeId"));
  return NextResponse.json({ tasks: await listCalendarTasks(calendarActor(auth.session!), { from, to, assigneeId: Number.isInteger(requestedAssignee) && requestedAssignee > 0 ? requestedAssignee : undefined, state: url.searchParams.get("state") ?? undefined }) });
}

export async function POST(request: Request) {
  const auth = await requirePermission("calendar"); if (auth.response) return auth.response;
  try { const parsed = calendarInput(await request.json() as Record<string, unknown>); if (!parsed) return NextResponse.json({ error: "Проверьте обязательные поля" }, { status: 400 }); return NextResponse.json(await createCalendarTask(calendarActor(auth.session!), parsed), { status: 201 }); }
  catch (error) { return calendarError(error); }
}
