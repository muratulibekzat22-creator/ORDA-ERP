import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { createRetailSale } from "@/lib/services/warehouse-retail.service";
import { WarehouseError, type WarehouseActor } from "@/lib/services/warehouse.service";

export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const locationId = Number(body.locationId);
    const clientId = body.clientId ? Number(body.clientId) : undefined;
    if (!Number.isInteger(locationId) || locationId <= 0 || (clientId !== undefined && (!Number.isInteger(clientId) || clientId <= 0)) || !Array.isArray(body.items) || !body.items.length || body.items.length > 100)
      return NextResponse.json({ error: "Некорректные данные продажи" }, { status: 400 });
    const items = body.items.map((raw) => {
      const row = raw as Record<string, unknown>;
      return { materialId: Number(row.materialId), quantity: Number(row.quantity), discount: row.discount == null || row.discount === "" ? 0 : Number(row.discount) };
    });
    const rawPayment = body.payment && typeof body.payment === "object" ? body.payment as Record<string, unknown> : null;
    const payment = rawPayment ? {
      amount: Number(rawPayment.amount),
      comment: typeof rawPayment.comment === "string" ? rawPayment.comment.slice(0, 500) : undefined,
      parts: Array.isArray(rawPayment.parts) ? rawPayment.parts.map((raw) => {
        const part = raw as Record<string, unknown>;
        return { method: String(part.method ?? ""), amount: Number(part.amount), reference: typeof part.reference === "string" ? part.reference.slice(0, 160) : undefined };
      }) : [],
    } : undefined;
    const client = body.client && typeof body.client === "object" ? body.client as { name: string; phone: string; city: string; address?: string } : undefined;
    const payload = { locationId, clientId, client, walkIn: body.walkIn === true, items, payment, issueNow: body.issueNow === true, recipientName: typeof body.recipientName === "string" ? body.recipientName.slice(0, 160) : undefined };
    const actor: WarehouseActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? null };
    const result = await createRetailSale({ ...payload, key: idempotency.key, requestHash: createRequestHash(payload), actor });
    return NextResponse.json({ ...result.result, receiptPdfStatus: result.receiptPdfStatus, invoicePdfStatus: result.invoicePdfStatus }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof WarehouseError) {
      const status = error.code === "FORBIDDEN" ? 403 : error.code.includes("INSUFFICIENT") || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : error.code === "NOT_FOUND" ? 404 : 400;
      const message = error.code === "INSUFFICIENT_AVAILABLE" ? "Недостаточно доступного товара" : error.code === "FORBIDDEN" ? "Недостаточно прав" : error.code === "NOT_FOUND" ? "Товар, клиент или склад не найден" : "Проверьте цену, количество, оплату и выдачу";
      return NextResponse.json({ error: message }, { status });
    }
    return NextResponse.json({ error: "Не удалось провести продажу" }, { status: 500 });
  }
}
