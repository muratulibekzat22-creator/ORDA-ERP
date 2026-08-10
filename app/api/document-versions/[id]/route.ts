import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { privateDocumentHeaders } from "@/lib/documents/download-response";
import { requirePermission } from "@/lib/server-auth";
import { getDocumentVersionContent, type DocumentActor } from "@/lib/services/document.service";

type Context = { params: Promise<{ id: string }> };
const actor = (session: { user: { id: string; role: string; name?: string | null } }): DocumentActor => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "" });
export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const representation = new URL(request.url).searchParams.get("representation") === "pdf" ? "pdf" : "source";
  const result = await getDocumentVersionContent(id, actor(auth.session!), representation);
  if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  return new NextResponse(result.blob.stream, {
    headers: privateDocumentHeaders(
      result.version,
      new URL(request.url).searchParams.get("download") === "1",
    ),
  });
}
