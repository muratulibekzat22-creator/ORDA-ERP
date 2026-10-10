import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  normalizeBrassCostBearer,
  normalizeBrassModelQuantities,
  totalBrassPairs,
} from "@/lib/brass/catalog";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requireInternalEmployee } from "@/lib/server-auth";
import {
  BrassProcurementError,
  createBrassProcurement,
  getOrderBrassProcurement,
} from "@/lib/services/brass-procurement.service";

type Context = { params: Promise<{ id: string }> };

const actor = (session: {
  user: { id: string; role: string; accountRole?: string; name?: string | null };
}) => ({
  userId: Number(session.user.id),
  role: (session.user.accountRole || session.user.role) as Role,
  name: session.user.name ?? "Сотрудник ORDA",
});

function failure(error: unknown) {
  if (error instanceof BrassProcurementError)
    return NextResponse.json(
      {
        error:
          error.code === "FORBIDDEN"
            ? "Недостаточно прав"
            : error.code === "NOT_FOUND"
              ? "Заказ не найден"
              : error.code === "INVALID"
                ? "Укажите количество хотя бы одной модели латуни"
                : error.code === "IDEMPOTENCY_CONFLICT"
                  ? "Повторный запрос содержит другие данные"
                  : "Заявка на латунь уже создана для этого заказа",
      },
      {
        status:
          error.code === "FORBIDDEN"
            ? 403
            : error.code === "NOT_FOUND"
              ? 404
              : error.code === "INVALID"
                ? 400
                : 409,
      },
    );
  return NextResponse.json(
    { error: "Не удалось сохранить заявку на латунь" },
    { status: 500 },
  );
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requireInternalEmployee();
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  try {
    return NextResponse.json(
      await getOrderBrassProcurement(orderId, actor(auth.session!)),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requireInternalEmployee();
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const form = await request.formData();
    const photoValue = form.get("photo");
    const photo = photoValue instanceof File && photoValue.size > 0
      ? photoValue
      : null;
    const modelQuantities = normalizeBrassModelQuantities({
      OVAL_BLACK: form.get("model_OVAL_BLACK"),
      OVAL_WHITE: form.get("model_OVAL_WHITE"),
      SQUARE_BLACK: form.get("model_SQUARE_BLACK"),
    });
    const legacyQuantityPairs = Number(form.get("quantityPairs"));
    if (totalBrassPairs(modelQuantities) === 0 && legacyQuantityPairs > 0)
      modelQuantities.OVAL_BLACK = legacyQuantityPairs;
    const costBearer = normalizeBrassCostBearer(form.get("costBearer"));
    const notes = String(form.get("notes") ?? "").trim().slice(0, 1000);
    const payload = {
      orderId,
      modelQuantities,
      costBearer,
      notes,
      fileName: photo?.name ?? null,
      contentType: photo?.type ?? null,
      size: photo?.size ?? 0,
    };
    const result = await createBrassProcurement({
      orderId,
      modelQuantities,
      costBearer,
      notes,
      photo,
      key: idempotency.key,
      requestHash: createRequestHash(payload),
      actor: actor(auth.session!),
    });
    return NextResponse.json(result.procurement, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    return failure(error);
  }
}
