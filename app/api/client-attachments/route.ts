import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { CLIENT_ATTACHMENT_TYPES, listClientAttachments, MAX_CLIENT_ATTACHMENT_SIZE, uploadClientAttachment } from "@/lib/services/client-attachment.service";

const positiveId = (value: unknown) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(request: Request) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const clientId = positiveId(new URL(request.url).searchParams.get("clientId"));
  if (!clientId) return NextResponse.json({ error: "Некорректный clientId" }, { status: 400 });
  const attachments = await listClientAttachments(clientId);
  return attachments ? NextResponse.json(attachments) : NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
}

export async function POST(request: Request) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  try {
    const form = await request.formData();
    const clientId = positiveId(form.get("clientId"));
    const file = form.get("file");
    if (!clientId || !(file instanceof File) || !file.name || file.size <= 0 || file.size > MAX_CLIENT_ATTACHMENT_SIZE || !CLIENT_ATTACHMENT_TYPES.has(file.type)) return NextResponse.json({ error: "Разрешены фото, видео, PDF, Word и Excel до 50 МБ" }, { status: 400 });
    const attachment = await uploadClientAttachment({ clientId, file, userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role });
    return attachment ? NextResponse.json(attachment, { status: 201 }) : NextResponse.json({ error: "Клиент не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "INVALID_FILE_TYPE") return NextResponse.json({ error: "Содержимое файла не соответствует его типу" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось загрузить файл" }, { status: 500 });
  }
}
