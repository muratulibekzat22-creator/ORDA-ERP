import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
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
                ? "Укажите количество пар и приложите фото латуни"
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
  const auth = await requirePermission("orders");
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
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const form = await request.formData();
    const photo = form.get("photo");
    const quantityPairs = Number(form.get("quantityPairs"));
    const notes = String(form.get("notes") ?? "").trim().slice(0, 1000);
    if (!(photo instanceof File))
      return NextResponse.json(
        { error: "Фото латунных балясин обязательно" },
        { status: 400 },
      );
    const payload = {
      orderId,
      quantityPairs,
      notes,
      fileName: photo.name,
      contentType: photo.type,
      size: photo.size,
    };
    const result = await createBrassProcurement({
      orderId,
      quantityPairs,
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
