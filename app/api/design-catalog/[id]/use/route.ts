import { NextResponse } from "next/server";

import { measurementActor } from "@/lib/measurement-api";
import { requirePermission } from "@/lib/server-auth";
import { applyCatalogItemAsMeasurementReference } from "@/lib/services/design-catalog.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  const catalogItemId = Number((await params).id);
  if (!Number.isInteger(catalogItemId) || catalogItemId <= 0)
    return NextResponse.json({ error: "Некорректная работа" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const measurementId = Number(body.measurementId);
    if (!Number.isInteger(measurementId) || measurementId <= 0)
      return NextResponse.json({ error: "Некорректный замер" }, { status: 400 });
    const result = await applyCatalogItemAsMeasurementReference({
      actor: measurementActor(auth.session!),
      measurementId,
      catalogItemId,
    });
    return result
      ? NextResponse.json(result, { status: 201 })
      : NextResponse.json({ error: "Замер не найден" }, { status: 404 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "FORBIDDEN")
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (code === "IMMUTABLE_MEASUREMENT")
      return NextResponse.json({ error: "Завершённый замер нельзя изменять" }, { status: 409 });
    if (code === "CATALOG_ITEM_NOT_FOUND")
      return NextResponse.json({ error: "Работа не найдена" }, { status: 404 });
    if (code === "CATALOG_REFERENCE_MUST_BE_IMAGE")
      return NextResponse.json({ error: "Для референса выберите фотографию" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось добавить референс" }, { status: 500 });
  }
}
