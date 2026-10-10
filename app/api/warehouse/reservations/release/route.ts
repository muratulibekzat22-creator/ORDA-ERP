import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { releaseWarehouseReservation } from "@/lib/services/warehouse-retail.service";
import { WarehouseError } from "@/lib/services/warehouse.service";
import { warehouseActorFromSession } from "@/lib/warehouse-access";

export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const orderItemId = Number(body.orderItemId);
    const locationId = Number(body.locationId);
    const quantity = Number(body.quantity);
    const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;
    if (
      !Number.isInteger(orderItemId) ||
      orderItemId <= 0 ||
      !Number.isInteger(locationId) ||
      locationId <= 0 ||
      !Number.isFinite(quantity) ||
      quantity <= 0
    )
      return NextResponse.json({ error: "Некорректное снятие резерва" }, { status: 400 });
    const payload = { orderItemId, locationId, quantity, reason };
    const result = await releaseWarehouseReservation({
      ...payload,
      key: idempotency.key,
      requestHash: createRequestHash(payload),
      actor: warehouseActorFromSession(auth.session!),
    });
    return NextResponse.json(result.result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof WarehouseError) {
      const message =
        error.code === "INSUFFICIENT_RESERVED"
          ? "Недостаточно товара в резерве"
          : error.code === "FORBIDDEN"
            ? "Недостаточно прав"
            : error.code === "NOT_FOUND"
              ? "Резерв не найден"
              : "Не удалось снять резерв";
      const status =
        error.code === "FORBIDDEN"
          ? 403
          : error.code === "NOT_FOUND"
            ? 404
            : error.code === "IDEMPOTENCY_CONFLICT" || error.code === "INSUFFICIENT_RESERVED"
              ? 409
              : 400;
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: "Ошибка снятия резерва" }, { status: 500 });
  }
}
