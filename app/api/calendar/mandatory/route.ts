import { NextResponse } from "next/server";

import { calendarActor } from "@/lib/calendar-api";
import { requireMandatoryTaskSession } from "@/lib/mandatory-task-auth";
import { acknowledgeMandatoryTask, getMandatoryTask } from "@/lib/services/mandatory-task.service";

export async function GET() {
  const auth = await requireMandatoryTaskSession();
  if (auth.response) return auth.response;
  return NextResponse.json({ pending: await getMandatoryTask(calendarActor(auth.session!)) }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await requireMandatoryTaskSession();
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => null) as { taskId?: unknown; plannedCompletionAt?: unknown; comment?: unknown } | null;
  const taskId = Number(body?.taskId);
  const plannedCompletionAt = new Date(String(body?.plannedCompletionAt ?? ""));
  if (!Number.isInteger(taskId) || taskId <= 0)
    return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  try {
    return NextResponse.json(await acknowledgeMandatoryTask(calendarActor(auth.session!), taskId, plannedCompletionAt, typeof body?.comment === "string" ? body.comment : ""));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: code === "INVALID_COMPLETION_DATE" ? "Укажите реальную дату выполнения" : "Задача не найдена" }, { status: code === "INVALID_COMPLETION_DATE" ? 400 : 404 });
  }
}
