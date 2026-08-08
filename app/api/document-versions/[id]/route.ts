import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { getDocumentVersionContent, type DocumentActor } from "@/lib/services/document.service";

type Context = { params: Promise<{ id: string }> };
const actor = (session: { user: { id: string; role: string; name?: string | null } }): DocumentActor => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "" });
export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const result = await getDocumentVersionContent(id, actor(auth.session!));
  if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(result.version.contentType) ? "inline" : "attachment";
  return new NextResponse(result.blob.stream, { headers: { "Content-Type": result.version.contentType, "Content-Length": String(result.version.size), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.version.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
