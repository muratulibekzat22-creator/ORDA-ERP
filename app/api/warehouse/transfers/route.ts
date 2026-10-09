import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { transferWarehouseStock } from "@/lib/services/warehouse-retail.service";
import { WarehouseError, type WarehouseActor } from "@/lib/services/warehouse.service";

const actor = (session: { user: { id: string; role: string; name?: string | null } }): WarehouseActor => ({
  userId: Number(session.user.id),
  role: session.user.role as Role,
  name: session.user.name ?? null,
});

export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const materialId = Number(body.materialId);
    const fromLocationId = Number(body.fromLocationId);
    const toLocationId = Number(body.toLocationId);
    const quantity = Number(body.quantity);
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    if (
      !Number.isInteger(materialId) || materialId <= 0 ||
      !Number.isInteger(fromLocationId) || fromLocationId <= 0 ||
      !Number.isInteger(toLocationId) || toLocationId <= 0 ||
      fromLocationId === toLocationId ||
      !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000 ||
      !reason
    ) return NextResponse.json({ error: "Укажите товар, разные места, количество и причину" }, { status: 400 });
    const payload = { materialId, fromLocationId, toLocationId, quantity, reason };
    return NextResponse.json(await transferWarehouseStock({
      ...payload,
      key: idempotency.key,
      requestHash: createRequestHash(payload),
      actor: actor(auth.session!),
    }));
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof WarehouseError) {
      if (error.code === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
      if (error.code === "NOT_FOUND") return NextResponse.json({ error: "Товар или место хранения не найдено" }, { status: 404 });
      if (error.code === "INSUFFICIENT_AVAILABLE") return NextResponse.json({ error: "Недостаточно доступного остатка в месте отправления" }, { status: 409 });
      if (error.code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Операция с таким ключом уже отличается" }, { status: 409 });
      return NextResponse.json({ error: "Недопустимое перемещение" }, { status: 400 });
    }
    return NextResponse.json({ error: "Не удалось провести перемещение" }, { status: 500 });
  }
}
