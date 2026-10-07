import { Role, StockCondition } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createWarehouseReturn } from "@/lib/services/warehouse-retail.service";
import { WarehouseError, type WarehouseActor } from "@/lib/services/warehouse.service";

export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const shipmentId = Number(body.shipmentId), locationId = Number(body.locationId);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    const lines = Array.isArray(body.lines) ? body.lines.map((raw) => {
      const row = raw as Record<string, unknown>;
      return { shipmentLineId: Number(row.shipmentLineId), quantity: Number(row.quantity), condition: row.condition === StockCondition.DAMAGED ? StockCondition.DAMAGED : StockCondition.SELLABLE };
    }) : [];
    if (!Number.isInteger(shipmentId) || shipmentId <= 0 || !Number.isInteger(locationId) || locationId <= 0 || !reason || !lines.length)
      return NextResponse.json({ error: "Некорректный возврат" }, { status: 400 });
    const payload = { shipmentId, locationId, reason, lines };
    const actor: WarehouseActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? null };
    const result = await createWarehouseReturn({ ...payload, key: idempotency.key, requestHash: createRequestHash(payload), actor });
    return NextResponse.json(result.result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof WarehouseError) return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Недостаточно прав" : error.code === "NOT_FOUND" ? "Отгрузка не найдена" : "Не удалось провести возврат" }, { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400 });
    return NextResponse.json({ error: "Ошибка возврата" }, { status: 500 });
  }
}
