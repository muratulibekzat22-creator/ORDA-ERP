import {
  PurchaseAllocationMethod,
  PurchaseBatchStatus,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  createPurchaseBatch,
  listPurchaseBatches,
  PurchaseError,
} from "@/lib/services/purchase.service";

const actor = (session: {
  user: { id: string; role: string; name?: string | null };
}) => ({
  userId: Number(session.user.id),
  role: session.user.role as Role,
  name: session.user.name ?? null,
});
const failure = (error: unknown) =>
  error instanceof PurchaseError
    ? NextResponse.json(
        { error: error.code },
        {
          status:
            error.code === "FORBIDDEN"
              ? 403
              : error.code === "NOT_FOUND"
                ? 404
                : 409,
        },
      )
    : NextResponse.json(
        { error: "Не удалось выполнить операцию" },
        { status: 500 },
      );
export async function GET(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const p = new URL(request.url).searchParams,
    page = Math.max(1, Number(p.get("page") ?? 1)),
    pageSize = Math.min(100, Math.max(1, Number(p.get("pageSize") ?? 20))),
    status = p.get("status");
  try {
    return NextResponse.json(
      await listPurchaseBatches(
        {
          page,
          pageSize,
          search: p.get("search") || undefined,
          status:
            status &&
            Object.values(PurchaseBatchStatus).includes(
              status as PurchaseBatchStatus,
            )
              ? (status as PurchaseBatchStatus)
              : undefined,
          supplierId: p.get("supplierId")
            ? Number(p.get("supplierId"))
            : undefined,
        },
        actor(auth.session!),
      ),
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = (await request.json()) as Record<string, unknown>,
      lines = Array.isArray(body.lines)
        ? (body.lines as Array<Record<string, unknown>>)
        : [];
    const allocationMethod = Object.values(PurchaseAllocationMethod).includes(
      body.allocationMethod as PurchaseAllocationMethod,
    )
      ? (body.allocationMethod as PurchaseAllocationMethod)
      : PurchaseAllocationMethod.BY_PURCHASE_VALUE;
    const payload = {
      supplierId: Number(body.supplierId),
      orderDate: new Date(String(body.orderDate)),
      expectedArrivalDate: body.expectedArrivalDate
        ? new Date(String(body.expectedArrivalDate))
        : undefined,
      purchaseCurrency: String(body.purchaseCurrency ?? "KZT"),
      fixedExchangeRate: Number(body.fixedExchangeRate ?? 1),
      allocationMethod,
      notes: String(body.notes ?? ""),
      lines: lines.map((line) => ({
        materialId: Number(line.materialId),
        orderedQuantity: Number(line.orderedQuantity),
        purchaseUnitPrice: Number(line.purchaseUnitPrice),
        weight: line.weight == null ? undefined : Number(line.weight),
      })),
    };
    if (
      !payload.supplierId ||
      !Number.isFinite(payload.orderDate.getTime()) ||
      payload.fixedExchangeRate <= 0 ||
      !payload.lines.length ||
      payload.lines.some(
        (line) =>
          !line.materialId ||
          line.orderedQuantity <= 0 ||
          line.purchaseUnitPrice < 0,
      )
    )
      return NextResponse.json(
        { error: "Некорректные данные партии" },
        { status: 400 },
      );
    const result = await createPurchaseBatch(
      { ...payload, key: key.key, requestHash: createRequestHash(payload) },
      actor(auth.session!),
    );
    return NextResponse.json(result.batch, {
      status: result.created ? 201 : 200,
    });
  } catch (error) {
    return failure(error);
  }
}
