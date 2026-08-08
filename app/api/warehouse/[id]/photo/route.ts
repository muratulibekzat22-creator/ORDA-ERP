import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { getWarehousePhoto, MAX_WAREHOUSE_PHOTO_SIZE, uploadWarehousePhoto, WAREHOUSE_PHOTO_TYPES } from "@/lib/services/warehouse-photo.service";

function parseId(value: string) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("warehouse"); if (auth.response) return auth.response;
  const id = parseId((await context.params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const result = await getWarehousePhoto(id); if (!result) return NextResponse.json({ error: "Фото не найдено" }, { status: 404 });
  return new Response(result.blob.stream, { headers: { "Content-Type": result.material.mainImageType!, "Content-Length": String(result.material.mainImageSize), "Content-Disposition": "inline", "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("warehouse"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  const id = parseId((await context.params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const file = (await request.formData()).get("file");
  if (!(file instanceof File) || !WAREHOUSE_PHOTO_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_WAREHOUSE_PHOTO_SIZE) return NextResponse.json({ error: "Разрешены JPG, PNG и WEBP до 8 МБ" }, { status: 400 });
  const result = await uploadWarehousePhoto(id, file, idempotency.key); return result ? NextResponse.json(result, { status: result.replayed ? 200 : 201 }) : NextResponse.json({ error: "Товар не найден" }, { status: 404 });
}
