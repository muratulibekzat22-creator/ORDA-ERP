import { DocumentType, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createDocument, deleteDocument, getDocuments, type DocumentActor } from "@/lib/services/document.service";

const documentTypes = new Set(Object.values(DocumentType));
const actor = (session: { user: { id: string; role: string } }): DocumentActor => ({ userId: Number(session.user.id), role: session.user.role as Role });
const positiveId = (value: unknown) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export async function GET(request: Request) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const orderId = params.has("orderId") ? positiveId(params.get("orderId")) : undefined;
  const type = params.get("type") || undefined;
  if (orderId === null || (type !== undefined && !documentTypes.has(type as DocumentType))) return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  try {
    return NextResponse.json(await getDocuments(actor(auth.session!), { orderId, type: type as DocumentType | undefined }));
  } catch {
    return NextResponse.json({ error: "Ошибка получения документов" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Array.isArray(body) || Object.keys(body).some((key) => !["orderId", "type", "number", "documentDate"].includes(key))) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    const orderId = positiveId(body.orderId);
    const type = typeof body.type === "string" && documentTypes.has(body.type as DocumentType) ? body.type as DocumentType : null;
    const number = typeof body.number === "string" ? body.number.trim() : "";
    const documentDate = typeof body.documentDate === "string" ? new Date(body.documentDate) : new Date(Number.NaN);
    if (!orderId || !type || !number || number.length > 80 || Number.isNaN(documentDate.getTime())) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    const payload = { orderId, type, number, documentDate: documentDate.toISOString() };
    const result = await createDocument({ ...payload, documentDate, idempotencyKey: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) });
    if (!result) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    return NextResponse.json(result.document, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "DOCUMENT_CONFLICT") return NextResponse.json({ error: "Документ этого типа или номера уже существует" }, { status: 409 });
    return NextResponse.json({ error: "Ошибка создания документа" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = positiveId(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const deleted = await deleteDocument(id, actor(auth.session!));
    return deleted ? NextResponse.json(deleted) : NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    return NextResponse.json({ error: "Ошибка удаления документа" }, { status: 500 });
  }
}
