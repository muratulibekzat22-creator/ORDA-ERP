import {
  PurchaseAllocationMethod,
  PurchaseCostType,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";
import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  addPurchaseCost,
  finalizePurchaseBatch,
  getPurchaseBatch,
  PurchaseError,
  receivePurchaseBatch,
} from "@/lib/services/purchase.service";
type Context = { params: Promise<{ id: string }> };
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
export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  try {
    const row = await getPurchaseBatch(
      Number((await params).id),
      actor(auth.session!),
    );
    return row
      ? NextResponse.json(row)
      : NextResponse.json({ error: "Партия не найдена" }, { status: 404 });
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    key = readIdempotencyKey(request);
  if ("response" in key) return key.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "receive")
      return NextResponse.json(
        await receivePurchaseBatch(
          id,
          Array.isArray(body.lines)
            ? body.lines.map((line) => ({
                lineId: Number((line as Record<string, unknown>).lineId),
                receivedQuantity: Number(
                  (line as Record<string, unknown>).receivedQuantity,
                ),
                rejectedQuantity: Number(
                  (line as Record<string, unknown>).rejectedQuantity ?? 0,
                ),
              }))
            : [],
          actor(auth.session!),
        ),
      );
    if (body.action === "finalize")
      return NextResponse.json(
        await finalizePurchaseBatch(
          id,
          body.manual && typeof body.manual === "object"
            ? (body.manual as Record<number, number>)
            : undefined,
          String(body.reason ?? "Final landed cost"),
          actor(auth.session!),
        ),
      );
    if (body.action === "cost") {
      const method = Object.values(PurchaseAllocationMethod).includes(
          body.allocationMethod as PurchaseAllocationMethod,
        )
          ? (body.allocationMethod as PurchaseAllocationMethod)
          : PurchaseAllocationMethod.BY_PURCHASE_VALUE,
        type = body.type as PurchaseCostType;
      if (!Object.values(PurchaseCostType).includes(type))
        return NextResponse.json(
          { error: "Некорректный тип расхода" },
          { status: 400 },
        );
      const payload = {
        batchId: id,
        type,
        provider: String(body.provider ?? ""),
        currency: String(body.currency ?? "KZT"),
        foreignAmount: Number(body.foreignAmount),
        exchangeRate: Number(body.exchangeRate ?? 1),
        documentDate: new Date(String(body.documentDate)),
        paymentDate: body.paymentDate
          ? new Date(String(body.paymentDate))
          : undefined,
        allocationMethod: method,
        comment: String(body.comment ?? ""),
        reference: body.reference ? String(body.reference) : undefined,
      };
      return NextResponse.json(
        (
          await addPurchaseCost(
            {
              ...payload,
              key: key.key,
              requestHash: createRequestHash(payload),
            },
            actor(auth.session!),
          )
        ).cost,
        { status: 201 },
      );
    }
    return NextResponse.json(
      { error: "Неизвестное действие" },
      { status: 400 },
    );
  } catch (error) {
    return failure(error);
  }
}
