import { NextResponse } from "next/server";

import { calendarActor } from "@/lib/calendar-api";
import { requireMandatoryTaskSession } from "@/lib/mandatory-task-auth";
import { submitMandatoryTaskResult } from "@/lib/services/mandatory-task.service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireMandatoryTaskSession();
  if (auth.response) return auth.response;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  try {
    const form = await request.formData();
    const file = form.get("file");
    return NextResponse.json(await submitMandatoryTaskResult(calendarActor(auth.session!), id, String(form.get("resultText") ?? ""), file instanceof File ? file : null));
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const message = code === "RESULT_REQUIRED" ? "Напишите результат или прикрепите файл" : code === "INVALID_RESULT_FILE" || code === "BLOB_TOO_LARGE" ? "Разрешены фото, PDF, Word, Excel и видео до 25 МБ" : "Не удалось отправить результат";
    return NextResponse.json({ error: message }, { status: code === "TASK_NOT_FOUND" ? 404 : 400 });
  }
}
