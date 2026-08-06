import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { logRequestFailure, productionLog } from "@/lib/observability";
import { requirePermission } from "@/lib/server-auth";
import { createMaterialCommand, createWarehouseOperation, deleteMaterialCommand, getWarehouse, updateMaterialCommand, WAREHOUSE_OPERATION_TYPES, WarehouseError, type WarehouseActor, type WarehouseOperationType } from "@/lib/services/warehouse.service";

const MAX_QUANTITY = 1_000_000_000, MAX_PRICE = 9_999_999_999.99;
const actor = (session: { user: { id: string; role: string; name?: string | null } }): WarehouseActor => ({ userId: Number(session.user.id), role: session.user.role as Role, name: session.user.name ?? null });
const positiveId = (value: unknown) => { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : null; };
const number = (value: unknown, max: number, allowZero = false) => { if (value === "" || value === null || value === undefined) return null; const parsed = Number(value); return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) && parsed <= max ? parsed : null; };
const text = (value: unknown, max: number, required = false) => { if (value == null) return required ? null : undefined; if (typeof value !== "string") return null; const parsed = value.trim(); return (!required || parsed) && parsed.length <= max ? parsed : null; };
const only = (body: Record<string, unknown>, allowed: string[]) => Object.keys(body).every((key) => allowed.includes(key));

function errorResponse(error: unknown) {
  if (!(error instanceof WarehouseError)) return null;
  if (error.code === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (error.code === "NOT_FOUND") return NextResponse.json({ error: "Материал или заказ не найден" }, { status: 404 });
  if (error.code === "IDEMPOTENCY_CONFLICT") return NextResponse.json({ error: "Idempotency-Key уже использован с другим payload" }, { status: 409 });
  if (error.code === "MATERIAL_DUPLICATE") return NextResponse.json({ error: "Материал с таким названием и единицей измерения уже существует" }, { status: 409 });
  if (error.code === "MATERIAL_IN_USE") return NextResponse.json({ error: "Нельзя удалить материал с движениями, резервами или связями с заказами" }, { status: 409 });
  if (error.code === "INSUFFICIENT_AVAILABLE") return NextResponse.json({ error: "Недостаточно доступного остатка" }, { status: 409 });
  if (error.code === "INSUFFICIENT_RESERVED") return NextResponse.json({ error: "Недостаточно зарезервированного материала" }, { status: 409 });
  if (error.code === "INSUFFICIENT_STOCK") return NextResponse.json({ error: "Недостаточно физического остатка" }, { status: 409 });
  return NextResponse.json({ error: "Недопустимая складская операция" }, { status: 400 });
}

async function authWarehouse() {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth;
  if (auth.session!.user.role === Role.PARTNER) return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return auth;
}

export async function GET(request: Request) {
  const auth = await authWarehouse(); if (auth.response) return auth.response;
  const params = new URL(request.url).searchParams;
  const page = params.has("page") ? positiveId(params.get("page")) : 1, pageSize = params.has("pageSize") ? positiveId(params.get("pageSize")) : 50;
  const orderId = params.has("orderId") ? positiveId(params.get("orderId")) : undefined, materialId = params.has("materialId") ? positiveId(params.get("materialId")) : undefined;
  const movementType = params.get("type") || undefined;
  if (!page || !pageSize || pageSize > 100 || orderId === null || materialId === null || (movementType && !WAREHOUSE_OPERATION_TYPES.includes(movementType as WarehouseOperationType))) return NextResponse.json({ error: "Некорректные параметры" }, { status: 400 });
  try { return NextResponse.json(await getWarehouse(actor(auth.session!), { page, pageSize, orderId, materialId, movementType })); }
  catch (error) { const response = errorResponse(error); if (response) return response; logRequestFailure("warehouse.read_failed", request, error); return NextResponse.json({ error: "Ошибка получения склада" }, { status: 500 }); }
}

export async function POST(request: Request) {
  const auth = await authWarehouse(); if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Array.isArray(body) || (body.action !== "material" && body.action !== "operation")) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    if (body.action === "material") {
      if (!only(body, ["action", "name", "category", "unit", "minimumStock", "purchasePrice", "supplier", "initialStock"])) return NextResponse.json({ error: "Недопустимые поля" }, { status: 400 });
      const name = text(body.name, 120, true), category = text(body.category, 80, true), unit = text(body.unit, 30, true), supplier = text(body.supplier, 160);
      const minimumStock = number(body.minimumStock, MAX_QUANTITY, true), purchasePrice = number(body.purchasePrice, MAX_PRICE, true), initialStock = number(body.initialStock ?? 0, MAX_QUANTITY, true);
      if (!name || !category || !unit || supplier === null || minimumStock === null || purchasePrice === null || initialStock === null) return NextResponse.json({ error: "Некорректные данные материала" }, { status: 400 });
      const payload = { name, category, unit, supplier, minimumStock, purchasePrice, initialStock };
      const result = await createMaterialCommand({ data: payload, key: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) });
      return NextResponse.json(result.result, { status: result.replayed ? 200 : 201 });
    }
    if (!only(body, ["action", "type", "materialId", "quantity", "price", "orderId", "supplier", "comment", "operationAt", "expiresAt"])) return NextResponse.json({ error: "Недопустимые поля" }, { status: 400 });
    const type = typeof body.type === "string" && WAREHOUSE_OPERATION_TYPES.includes(body.type as WarehouseOperationType) ? body.type as WarehouseOperationType : null;
    const materialId = positiveId(body.materialId), orderId = body.orderId == null || body.orderId === "" ? undefined : positiveId(body.orderId), quantity = number(body.quantity, MAX_QUANTITY, type === "adjustment");
    const price = body.price == null || body.price === "" ? undefined : number(body.price, MAX_PRICE, true), supplier = text(body.supplier, 160), comment = text(body.comment, 1000);
    const operationAt = body.operationAt ? new Date(String(body.operationAt)) : undefined, expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : undefined;
    if (!type || !materialId || orderId === null || quantity === null || price === null || supplier === null || comment === null || (operationAt && (Number.isNaN(operationAt.getTime()) || operationAt.getTime() > Date.now() + 300_000)) || (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()))) return NextResponse.json({ error: "Некорректные данные операции" }, { status: 400 });
    const payload = { type, materialId, orderId, quantity, price, supplier, comment, operationAt: operationAt?.toISOString(), expiresAt: expiresAt?.toISOString() };
    const result = await createWarehouseOperation({ data: { type, materialId, orderId, quantity, price, supplier, comment, operationAt, expiresAt }, key: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) });
    return NextResponse.json(result.result, { status: result.replayed ? 200 : 201 });
  } catch (error) { if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); const response = errorResponse(error); if (response) { if (error instanceof WarehouseError && error.code.includes("INSUFFICIENT")) productionLog("warn", "warehouse.conflict", { requestId: request.headers.get("x-request-id") ?? undefined, route: "/api/warehouse", method: "POST", reason: error.code }); return response; } logRequestFailure("warehouse.mutation_failed", request, error); return NextResponse.json({ error: "Ошибка складской операции" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const auth = await authWarehouse(); if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Array.isArray(body) || !only(body, ["id", "name", "category", "unit", "minimumStock", "purchasePrice", "supplier", "active"])) return NextResponse.json({ error: "Недопустимые поля" }, { status: 400 });
    const id = positiveId(body.id), data: { name?: string; category?: string; unit?: string; minimumStock?: number; purchasePrice?: number; supplier?: string | null; active?: boolean } = {};
    for (const [field, max] of [["name", 120], ["category", 80], ["unit", 30]] as const) if (body[field] !== undefined) { const value = text(body[field], max, true); if (!value) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 }); data[field] = value; }
    if (body.supplier !== undefined) { const value = body.supplier === null || body.supplier === "" ? null : text(body.supplier, 160); if (value === null && body.supplier !== null && body.supplier !== "") return NextResponse.json({ error: "Некорректные данные" }, { status: 400 }); data.supplier = value; }
    if (body.minimumStock !== undefined) { const value = number(body.minimumStock, MAX_QUANTITY, true); if (value === null) return NextResponse.json({ error: "Некорректный минимальный остаток" }, { status: 400 }); data.minimumStock = value; }
    if (body.purchasePrice !== undefined) { const value = number(body.purchasePrice, MAX_PRICE, true); if (value === null) return NextResponse.json({ error: "Некорректная цена" }, { status: 400 }); data.purchasePrice = value; }
    if (body.active !== undefined) { if (typeof body.active !== "boolean") return NextResponse.json({ error: "Некорректная активность" }, { status: 400 }); data.active = body.active; }
    if (!id || !Object.keys(data).length) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
    const payload = { id, ...data }; const result = await updateMaterialCommand({ id, data, key: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) });
    return NextResponse.json(result.result);
  } catch (error) { if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }); const response = errorResponse(error); if (response) return response; logRequestFailure("warehouse.material_update_failed", request, error); return NextResponse.json({ error: "Ошибка обновления материала" }, { status: 500 }); }
}

export async function DELETE(request: Request) {
  const auth = await authWarehouse(); if (auth.response) return auth.response;
  const idempotency = readIdempotencyKey(request); if ("response" in idempotency) return idempotency.response;
  const id = positiveId(new URL(request.url).searchParams.get("id")); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { const payload = { id }; const result = await deleteMaterialCommand({ id, key: idempotency.key, requestHash: createRequestHash(payload), actor: actor(auth.session!) }); return NextResponse.json(result.result); }
  catch (error) { const response = errorResponse(error); if (response) return response; logRequestFailure("warehouse.material_delete_failed", request, error); return NextResponse.json({ error: "Ошибка удаления материала" }, { status: 500 }); }
}
