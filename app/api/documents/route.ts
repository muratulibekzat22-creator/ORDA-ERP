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
  const page = params.has("page") ? Number(params.get("page")) : null;
  const limit = params.has("limit") ? Number(params.get("limit")) : 50;
  if ((page !== null && (!Number.isInteger(page) || page < 1)) || !Number.isInteger(limit) || limit < 1 || limit > 100) return NextResponse.json({ error: "Invalid pagination" }, { status: 400 });
  if (orderId === null || clientId === null || authorId === null || (type && !documentTypes.has(type as DocumentType)) || (status && !documentStatuses.has(status as DocumentStatus)) || (from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  try {
    const documents = await getDocuments(actor(auth.session!), { orderId, clientId, authorId, type: type as DocumentType | undefined, status: status as DocumentStatus | undefined, query: params.get("q") ?? undefined, from, to, includeArchived: params.get("includeArchived") === "1", ...(page === null ? {} : { skip: (page - 1) * limit, take: limit + 1 }) });
    return NextResponse.json(page === null ? documents : { data: documents.slice(0, limit), pagination: { page, limit, hasMore: documents.length > limit } });
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
    const orderId = optionalId(body.orderId), clientId = optionalId(body.clientId), paymentId = optionalId(body.paymentId);
    const type = typeof body.type === "string" && documentTypes.has(body.type as DocumentType) ? body.type as DocumentType : null;
    const documentDate = date(body.documentDate);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const number = typeof body.number === "string" ? body.number.trim() : "";
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const paymentAmount = Number(body.paymentAmount), paymentDate = date(body.paymentDate), paymentMethod = typeof body.paymentMethod === "string" ? body.paymentMethod.trim().slice(0, 80) : "";
    const isPaymentReceipt = type === DocumentType.PAYMENT_RECEIPT;
    const invalidPaymentReceipt = isPaymentReceipt && (!orderId || !file || (!paymentId && (!Number.isFinite(paymentAmount) || paymentAmount <= 0 || !paymentDate || Number.isNaN(paymentDate.getTime()) || !paymentMethod)));
    if (orderId === null || clientId === null || paymentId === null || (!orderId && !clientId) || !type || !documentDate || Number.isNaN(documentDate.getTime()) || title.length > 200 || number.length > 80 || comment.length > 2000 || (paymentId && !isPaymentReceipt) || invalidPaymentReceipt) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    if (file && (file.size <= 0 || file.size > MAX_DOCUMENT_SIZE || !DOCUMENT_CONTENT_TYPES.has(file.type))) return NextResponse.json({ error: "Разрешены PDF, Word, Excel и изображения до 15 МБ" }, { status: 400 });
    const fileHash = file ? createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex") : null;
    const paymentSnapshot = isPaymentReceipt && !paymentId ? { amount: paymentAmount, operationDate: paymentDate!.toISOString(), method: paymentMethod, comment } : null;
    const payload = { orderId: orderId ?? null, clientId: clientId ?? null, paymentId: paymentId ?? null, paymentSnapshot, type, title, number, documentDate: documentDate.toISOString(), comment, fileName: file?.name ?? null, fileType: file?.type ?? null, fileSize: file?.size ?? null, fileHash };
    const result = await createDocument({ orderId, clientId, paymentId, paymentSnapshot, type, title, number, documentDate, comment, file, idempotencyKey: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) });
    if (!result) return NextResponse.json({ error: "Клиент или заказ не найден" }, { status: 404 });
    return NextResponse.json(result.document, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "ENTITY_MISMATCH") return NextResponse.json({ error: "Заказ не принадлежит выбранному клиенту" }, { status: 400 });
    if (error instanceof Error && error.message === "PAYMENT_NOT_FOUND") return NextResponse.json({ error: "Оплата не найдена или не относится к этому заказу" }, { status: 404 });
    if (error instanceof Error && error.message === "INVALID_FILE_TYPE") return NextResponse.json({ error: "Содержимое файла не соответствует безопасному формату" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "DOCUMENT_CONFLICT") return NextResponse.json({ error: "Документ этого типа или номера уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Ошибка создания документа" }, { status: 500 });
  }
}
