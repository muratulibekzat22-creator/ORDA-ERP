import { NextResponse } from "next/server";
import { measurementActor } from "@/lib/measurement-api";
import { requirePermission } from "@/lib/server-auth";
import { deleteMeasurementAttachment, getMeasurementAttachment } from "@/lib/services/measurement-attachment.service";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("measurements"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const result = await getMeasurementAttachment(measurementActor(auth.session!), id);
  if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(result.blob.stream, { headers: { "Content-Type": result.attachment.contentType, "Content-Length": String(result.attachment.size), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`, "Cache-Control": "private, no-store" } });
}

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("measurements"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  try {
    const result = await deleteMeasurementAttachment(measurementActor(auth.session!), id);
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "IMMUTABLE_MEASUREMENT") return NextResponse.json({ error: "Фото завершённого замера нельзя удалить" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось удалить фото" }, { status: 500 });
  }
}
