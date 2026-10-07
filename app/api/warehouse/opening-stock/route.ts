import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import { fillMiniSpigotFacts } from "@/lib/services/warehouse-retail.service";
import { WarehouseError, type WarehouseActor } from "@/lib/services/warehouse.service";

const finite = (value: unknown, scale: number) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && Math.abs(number * 10 ** scale - Math.round(number * 10 ** scale)) < 1e-7 ? number : null;
};

export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const locationId = Number(body.locationId);
    if (!Number.isInteger(locationId) || locationId <= 0 || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > 20)
      return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    const rows = body.rows.map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const row = raw as Record<string, unknown>;
      const materialId = Number(row.materialId);
      const quantity = row.quantity === undefined || row.quantity === "" ? undefined : finite(row.quantity, 3);
      const purchasePrice = row.purchasePrice === undefined ? undefined : row.purchasePrice === "" || row.purchasePrice === null ? null : finite(row.purchasePrice, 2);
      const sellingPrice = row.sellingPrice === undefined ? undefined : row.sellingPrice === "" || row.sellingPrice === null ? null : finite(row.sellingPrice, 2);
      if (!Number.isInteger(materialId) || materialId <= 0 || quantity === null || (row.purchasePrice !== undefined && row.purchasePrice !== "" && row.purchasePrice !== null && purchasePrice === null) || (row.sellingPrice !== undefined && row.sellingPrice !== "" && row.sellingPrice !== null && sellingPrice === null)) return null;
      return { materialId, quantity, purchasePrice, sellingPrice };
    });
    if (rows.some((row) => row === null)) return NextResponse.json({ error: "Проверьте количество и цены" }, { status: 400 });
    const payload = { locationId, rows };
    const actor: WarehouseActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? null };
    const result = await fillMiniSpigotFacts({ locationId, rows: rows as NonNullable<(typeof rows)[number]>[], key: idempotency.key, requestHash: createRequestHash(payload), actor });
    return NextResponse.json(result.result, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    if (error instanceof WarehouseError) return NextResponse.json({ error: error.code === "FORBIDDEN" ? "Изменять остатки и цены могут только директор и основатель" : error.code === "IDEMPOTENCY_CONFLICT" ? "Повторный ключ относится к другой операции" : "Не удалось сохранить фактические данные" }, { status: error.code === "FORBIDDEN" ? 403 : error.code.includes("INSUFFICIENT") || error.code === "IDEMPOTENCY_CONFLICT" ? 409 : 400 });
    return NextResponse.json({ error: "Ошибка сохранения" }, { status: 500 });
  }
}
