import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createWarehouseShipment } from "@/lib/services/warehouse-retail.service";
import { WarehouseError } from "@/lib/services/warehouse.service";
import { warehouseActorFromSession } from "@/lib/warehouse-access";

export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId), locationId = Number(body.locationId);
    const lines = Array.isArray(body.lines) ? body.lines.map((raw) => ({ orderItemId: Number((raw as Record<string, unknown>).orderItemId), quantity: Number((raw as Record<string, unknown>).quantity) })) : [];
    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isInteger(locationId) || locationId <= 0 || !lines.length)
      return NextResponse.json({ error: "Некорректная выдача" }, { status: 400 });
    const payload = { orderId, locationId, lines, recipientName: typeof body.recipientName === "string" ? body.recipientName.slice(0, 160) : undefined };
    const result = await createWarehouseShipment({ ...payload, key: idempotency.key, requestHash: createRequestHash(payload), actor: warehouseActorFromSession(auth.session!) });
    return NextResponse.json({ ...result.result, pdfStatus: result.pdfStatus }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof WarehouseError) return NextResponse.json({ error: error.code === "INSUFFICIENT_AVAILABLE" || error.code === "INSUFFICIENT_STOCK" ? "Недостаточно товара для выдачи" : error.code === "FORBIDDEN" ? "Недостаточно прав" : "Не удалось провести выдачу" }, { status: error.code === "FORBIDDEN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code.includes("INSUFFICIENT") || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400 });
    return NextResponse.json({ error: "Ошибка выдачи" }, { status: 500 });
  }
}
