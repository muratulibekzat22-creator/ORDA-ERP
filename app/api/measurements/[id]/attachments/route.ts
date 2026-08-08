import { MeasurementPhotoType } from "@prisma/client";
import { NextResponse } from "next/server";
import { measurementActor } from "@/lib/measurement-api";
import { logRequestFailure } from "@/lib/observability";
import { requirePermission } from "@/lib/server-auth";
import { listMeasurementAttachments, MAX_MEASUREMENT_PHOTO_SIZE, MEASUREMENT_PHOTO_CONTENT_TYPES, uploadMeasurementAttachment } from "@/lib/services/measurement-attachment.service";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("measurements"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const result = await listMeasurementAttachments(measurementActor(auth.session!), id);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Замер не найден" }, { status: 404 });
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("measurements"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const form = await request.formData(), file = form.get("file"), type = form.get("type");
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_MEASUREMENT_PHOTO_SIZE || !MEASUREMENT_PHOTO_CONTENT_TYPES.has(file.type) || typeof type !== "string" || !Object.values(MeasurementPhotoType).includes(type as MeasurementPhotoType)) return NextResponse.json({ error: "Разрешены JPG, PNG и WebP до 15 МБ; укажите тип фото" }, { status: 400 });
    const result = await uploadMeasurementAttachment({ actor: measurementActor(auth.session!), measurementId: id, type: type as MeasurementPhotoType, file });
    return result ? NextResponse.json(result, { status: 201 }) : NextResponse.json({ error: "Замер не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error instanceof Error && error.message === "IMMUTABLE_MEASUREMENT") return NextResponse.json({ error: "Фото завершённого замера нельзя изменять" }, { status: 409 });
    if (error instanceof Error && error.message === "INVALID_FILE_TYPE") return NextResponse.json({ error: "Содержимое файла не соответствует формату изображения" }, { status: 400 });
    logRequestFailure("blob.measurement_upload_failed", request, error);
    return NextResponse.json({ error: "Не удалось загрузить фото" }, { status: 500 });
  }
}
