import { DocumentStatus, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { getDocument, updateDocument, type DocumentActor } from "@/lib/services/document.service";

type Context = { params: Promise<{ id: string }> };
const actor = (session: { user: { id: string; role: string; name?: string | null } }): DocumentActor => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "" });
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const document = await getDocument(id, actor(auth.session!));
  return document ? NextResponse.json(document) : NextResponse.json({ error: "Документ не найден" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const status = typeof body.status === "string" && Object.values(DocumentStatus).includes(body.status as DocumentStatus) ? body.status as DocumentStatus : undefined;
    const signedAt = typeof body.signedAt === "string" ? new Date(body.signedAt) : undefined;
    if (!status && body.comment === undefined) return NextResponse.json({ error: "Нет изменений" }, { status: 400 });
    if (signedAt && Number.isNaN(signedAt.getTime())) return NextResponse.json({ error: "Некорректная дата" }, { status: 400 });
    const result = await updateDocument(id, actor(auth.session!), { status, signedAt, signedComment: typeof body.signedComment === "string" ? body.signedComment : undefined, comment: typeof body.comment === "string" ? body.comment : undefined });
    return result ? NextResponse.json(result) : NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "SIGNED_FILE_REQUIRED") return NextResponse.json({ error: "Сначала загрузите подписанный договор" }, { status: 400 });
    return NextResponse.json({ error: "Ошибка изменения документа" }, { status: 500 });
  }
}
