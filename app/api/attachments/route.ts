import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { ALLOWED_ATTACHMENT_TYPES, deleteAttachment, listAttachments, MAX_ATTACHMENT_SIZE, uploadAttachment, type AttachmentActor } from "@/lib/services/attachment.service";

const actor = (session: { user: { id: string; role: string } }): AttachmentActor => ({ userId: Number(session.user.id), role: session.user.role as Role });
const positiveId = (value: unknown) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(request: Request) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const orderId = positiveId(new URL(request.url).searchParams.get("orderId"));
  if (!orderId) return NextResponse.json({ error: "Некорректный orderId" }, { status: 400 });
  try {
    const attachments = await listAttachments(orderId, actor(auth.session!));
    return attachments ? NextResponse.json(attachments) : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  } catch {
    return NextResponse.json({ error: "Ошибка получения файлов" }, { status: 500 });
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
    const form = await request.formData();
    const orderId = positiveId(form.get("orderId"));
    const documentValue = form.get("documentId");
    const documentId = documentValue == null || documentValue === "" ? undefined : positiveId(documentValue);
    const file = form.get("file");
    if (!orderId || documentId === null || !(file instanceof File) || !file.name || file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE || !ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
      return NextResponse.json({ error: "Разрешены PDF, JPG, PNG, WEBP, DOC, DOCX, XLS и XLSX размером до 10 МБ" }, { status: 400 });
    }
    const result = await uploadAttachment({ orderId, documentId, file, idempotencyKey: idempotency.key, actor: actor(auth.session!) });
    if (!result) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    return NextResponse.json(result.attachment, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
    if (error instanceof Error && error.message === "INVALID_DOCUMENT") return NextResponse.json({ error: "Документ не принадлежит заказу" }, { status: 400 });
    if (error instanceof Error && error.message === "INVALID_FILE_TYPE") return NextResponse.json({ error: "Содержимое файла не соответствует разрешённому типу" }, { status: 400 });
    return NextResponse.json({ error: "Ошибка загрузки файла" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = positiveId(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const deleted = await deleteAttachment(id, actor(auth.session!));
    return deleted ? NextResponse.json(deleted) : NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    return NextResponse.json({ error: "Ошибка удаления файла" }, { status: 500 });
  }
}
