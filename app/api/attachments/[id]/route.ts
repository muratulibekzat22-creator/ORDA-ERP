import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getAttachmentContent, type AttachmentActor } from "@/lib/services/attachment.service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const actor: AttachmentActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role };
    const result = await getAttachmentContent(id, actor);
    if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    const inlineRequested = new URL(request.url).searchParams.get("disposition") === "inline";
    const inlineAllowed = result.attachment.contentType === "application/pdf" || result.attachment.contentType.startsWith("image/");
    const disposition = inlineRequested && inlineAllowed ? "inline" : "attachment";
    const encodedName = encodeURIComponent(result.attachment.fileName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(result.blob.stream, { headers: {
      "Content-Type": result.attachment.contentType,
      "Content-Length": String(result.attachment.size),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return NextResponse.json({ error: "Ошибка получения файла" }, { status: 500 });
  }
}
