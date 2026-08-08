import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { addDocumentVersion, MAX_DOCUMENT_SIZE, type DocumentActor } from "@/lib/services/document.service";

type Context = { params: Promise<{ id: string }> };
const actor = (session: { user: { id: string; role: string; name?: string | null } }): DocumentActor => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "" });
export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_DOCUMENT_SIZE) return NextResponse.json({ error: "Выберите файл до 15 МБ" }, { status: 400 });
    const result = await addDocumentVersion(id, actor(auth.session!), file, typeof form.get("comment") === "string" ? String(form.get("comment")) : undefined);
    return result ? NextResponse.json(result, { status: 201 }) : NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "INVALID_FILE_TYPE") return NextResponse.json({ error: "Содержимое файла не соответствует безопасному формату" }, { status: 400 });
    return NextResponse.json({ error: "Ошибка загрузки версии" }, { status: 500 });
  }
}
