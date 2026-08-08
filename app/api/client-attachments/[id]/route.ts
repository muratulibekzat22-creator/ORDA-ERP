import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { deleteClientAttachment, getClientAttachment } from "@/lib/services/client-attachment.service";
import type { DocumentActor } from "@/lib/services/document.service";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const actor: DocumentActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? "" };
  const result = await getClientAttachment(id, actor);
  if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(result.blob.stream, { headers: { "Content-Type": result.attachment.contentType, "Content-Length": String(result.attachment.size), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`, "Cache-Control": "private, no-store" } });
}

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  try {
    const actor: DocumentActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? "" };
    const deleted = await deleteClientAttachment(id, actor);
    return deleted ? NextResponse.json(deleted) : NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    return NextResponse.json({ error: "Не удалось удалить файл" }, { status: 500 });
  }
}
