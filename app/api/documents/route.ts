import { createHash } from "crypto";
import { DocumentStatus, DocumentType, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createDocument, DOCUMENT_CONTENT_TYPES, getDocuments, MAX_DOCUMENT_SIZE, type DocumentActor } from "@/lib/services/document.service";

const documentTypes = new Set(Object.values(DocumentType));
const documentStatuses = new Set(Object.values(DocumentStatus));
const actor = (session: { user: { id: string; role: string; name?: string | null } }): DocumentActor => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? "" });
const positiveId = (value: unknown) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };
const optionalId = (value: unknown) => value === undefined || value === null || value === "" ? undefined : positiveId(value);
const date = (value: unknown) => typeof value === "string" && value ? new Date(value) : undefined;

export async function GET(request: Request) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const orderId = params.has("orderId") ? positiveId(params.get("orderId")) : undefined;
  const clientId = params.has("clientId") ? positiveId(params.get("clientId")) : undefined;
  const authorId = params.has("authorId") ? positiveId(params.get("authorId")) : undefined;
  const type = params.get("type") || undefined, status = params.get("status") || undefined;
  const from = date(params.get("from")), to = date(params.get("to"));
  if (orderId === null || clientId === null || authorId === null || (type && !documentTypes.has(type as DocumentType)) || (status && !documentStatuses.has(status as DocumentStatus)) || (from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  try {
    return NextResponse.json(await getDocuments(actor(auth.session!), { orderId, clientId, authorId, type: type as DocumentType | undefined, status: status as DocumentStatus | undefined, query: params.get("q") ?? undefined, from, to, includeArchived: params.get("includeArchived") === "1" }));
  } catch { return NextResponse.json({ error: "Ошибка получения документов" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER && role !== Role.ACCOUNTANT) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  try {
    const multipart = request.headers.get("content-type")?.includes("multipart/form-data");
    let body: Record<string, unknown>, file: File | undefined;
    if (multipart) {
      const form = await request.formData(), candidate = form.get("file");
      if (!(candidate instanceof File)) return NextResponse.json({ error: "Выберите файл" }, { status: 400 });
      file = candidate;
      body = Object.fromEntries([...form.entries()].filter(([key]) => key !== "file"));
    } else body = await request.json() as Record<string, unknown>;
    const orderId = optionalId(body.orderId), clientId = optionalId(body.clientId);
    const type = typeof body.type === "string" && documentTypes.has(body.type as DocumentType) ? body.type as DocumentType : null;
    const documentDate = date(body.documentDate);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const number = typeof body.number === "string" ? body.number.trim() : "";
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (orderId === null || clientId === null || (!orderId && !clientId) || !type || !documentDate || Number.isNaN(documentDate.getTime()) || title.length > 200 || number.length > 80 || comment.length > 2000) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    if (file && (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE || !DOCUMENT_CONTENT_TYPES.has(file.type))) return NextResponse.json({ error: "Разрешены PDF, Word, Excel и изображения до 15 МБ" }, { status: 400 });
    const fileHash = file ? createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex") : null;
    const payload = { orderId: orderId ?? null, clientId: clientId ?? null, type, title, number, documentDate: documentDate.toISOString(), comment, fileName: file?.name ?? null, fileType: file?.type ?? null, fileSize: file?.size ?? null, fileHash };
    const result = await createDocument({ orderId, clientId, type, title, number, documentDate, comment, file, idempotencyKey: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) });
    if (!result) return NextResponse.json({ error: "Клиент или заказ не найден" }, { status: 404 });
    return NextResponse.json(result.document, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "ENTITY_MISMATCH") return NextResponse.json({ error: "Заказ не принадлежит выбранному клиенту" }, { status: 400 });
    if (error instanceof Error && error.message === "INVALID_FILE_TYPE") return NextResponse.json({ error: "Содержимое файла не соответствует безопасному формату" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "DOCUMENT_CONFLICT") return NextResponse.json({ error: "Документ этого типа или номера уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Ошибка создания документа" }, { status: 500 });
  }
}
