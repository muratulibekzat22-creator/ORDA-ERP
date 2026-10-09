import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  BrassProcurementError,
  markBrassInTransit,
  placeBrassOrder,
  receiveBrassProcurement,
  recordBrassPayment,
} from "@/lib/services/brass-procurement.service";

type Context = { params: Promise<{ id: string }> };

const actor = (session: {
  user: { id: string; role: string; accountRole?: string; name?: string | null };
}) => ({
  userId: Number(session.user.id),
  role: (session.user.accountRole || session.user.role) as Role,
  name: session.user.name ?? "Сотрудник ORDA",
});

function requiredDate(value: unknown) {
  const result = new Date(String(value ?? ""));
  if (!Number.isFinite(result.getTime()))
    throw new BrassProcurementError("INVALID");
  return result;
}

function failure(error: unknown) {
  if (error instanceof BrassProcurementError)
    return NextResponse.json(
      {
        error:
          error.code === "FORBIDDEN"
            ? "Недостаточно прав"
            : error.code === "NOT_FOUND"
              ? "Заявка не найдена"
              : error.code === "INVALID"
                ? "Проверьте сумму, даты и обязательные поля"
                : error.code === "IDEMPOTENCY_CONFLICT"
                  ? "Повторный запрос содержит другие данные"
                  : "Операция недоступна для текущего статуса",
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
    { error: "Не удалось выполнить операцию с закупкой латуни" },
    { status: 500 },
  );
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("warehouse");
  if (auth.response) return auth.response;
  const procurementId = Number((await params).id);
  if (!Number.isInteger(procurementId) || procurementId <= 0)
    return NextResponse.json({ error: "Некорректная заявка" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const requestActor = actor(auth.session!);
    if (body.action === "in_transit")
      return NextResponse.json(
        await markBrassInTransit(procurementId, requestActor),
      );
    if (body.action === "order") {
      const expectedArrivalDate = requiredDate(body.expectedArrivalDate);
      const payload = {
        procurementId,
        supplierId: Number(body.supplierId),
        expectedArrivalDate: expectedArrivalDate.toISOString(),
        purchaseCurrency: String(body.purchaseCurrency ?? "KZT"),
        exchangeRate: Number(body.exchangeRate ?? 1),
        unitPurchasePrice: Number(body.unitPurchasePrice),
        responsibleUserId: requestActor.userId,
        notes: String(body.notes ?? ""),
      };
      return NextResponse.json(
        await placeBrassOrder({
          ...payload,
          expectedArrivalDate,
          key: idempotency.key,
          requestHash: createRequestHash(payload),
          actor: requestActor,
        }),
      );
    }
    if (body.action === "payment") {
      const paidAt = requiredDate(body.paidAt);
      const kind = body.kind === "CARGO" ? "CARGO" : "SUPPLIER";
      const payload = {
        procurementId,
        kind,
        amount: Number(body.amount),
        method: String(body.method ?? "BANK_TRANSFER"),
        paidAt: paidAt.toISOString(),
        comment: String(body.comment ?? ""),
      } as const;
      return NextResponse.json(
        await recordBrassPayment({
          ...payload,
          paidAt,
          key: idempotency.key,
          requestHash: createRequestHash(payload),
          actor: requestActor,
        }),
        { status: 201 },
      );
    }
    if (body.action === "receive") {
      const receivedAt = requiredDate(body.receivedAt);
      const payload = {
        procurementId,
        locationId: Number(body.locationId),
        receivedAt: receivedAt.toISOString(),
        cargoCostKzt: Number(body.cargoCostKzt ?? 0),
        cargoProvider: String(body.cargoProvider ?? "Карго"),
        supplierDocumentNumber: body.supplierDocumentNumber
          ? String(body.supplierDocumentNumber)
          : undefined,
        note: String(body.note ?? ""),
      };
      return NextResponse.json(
        await receiveBrassProcurement({
          ...payload,
          receivedAt,
          key: idempotency.key,
          requestHash: createRequestHash(payload),
          actor: requestActor,
        }),
      );
    }
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
