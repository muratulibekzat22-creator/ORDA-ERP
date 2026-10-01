import { NextResponse } from "next/server";

import { calendarActor } from "@/lib/calendar-api";
import { requireMandatoryTaskSession } from "@/lib/mandatory-task-auth";
import { getTaskResultAttachment } from "@/lib/services/mandatory-task.service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireMandatoryTaskSession();
  if (auth.response) return auth.response;
  const id = Number((await context.params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const result = await getTaskResultAttachment(calendarActor(auth.session!), id);
  if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(result.blob.stream, { headers: { "Content-Type": result.attachment.contentType, "Content-Length": String(result.attachment.size), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`, "Cache-Control": "private, no-store" } });
}
