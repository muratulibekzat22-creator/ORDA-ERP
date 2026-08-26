import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  closeOrderFinancially,
  completeDeliveredOrder,
  OrderCompletionError,
  type OrderCompletionActor,
} from "@/lib/services/order-completion.service";

type Context = { params: Promise<{ id: string }> };

function actor(session: {
  user: { id: string; name?: string | null; role: string };
}): OrderCompletionActor {
  return {
    userId: Number(session.user.id),
    name: session.user.name ?? "ORDA",
    role: session.user.role as Role,
  };
}

function failure(error: unknown) {
  if (!(error instanceof OrderCompletionError))
    return NextResponse.json(
      { error: "Не удалось сохранить завершение заказа" },
      { status: 500 },
    );
  if (error.message === "FORBIDDEN")
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (error.message === "ORDER_NOT_FOUND")
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  if (error.message === "IDEMPOTENCY_CONFLICT")
    return NextResponse.json(
      { error: "Повторный запрос отличается от исходного" },
      { status: 409 },
    );
  if (error.message.startsWith("OBLIGATIONS_OPEN:")) {
    const [, client, partner, payroll] = error.message.split(":");
    return NextResponse.json(
      {
        error: "Сначала закройте обязательства по заказу",
        obligations: { client, partner, payroll },
      },
      { status: 409 },
    );
  }
  const labels: Record<string, string> = {
    INVALID_DATE: "Проверьте дату сдачи",
    ORDER_CANCELLED: "Отменённый заказ нельзя завершить",
    ORDER_NOT_COMPLETED: "Сначала отметьте объект сданным",
    ORDER_SETTLEMENT_INCOMPLETE: "Сначала укажите цех и согласованную стоимость",
    REASON_REQUIRED: "Укажите основание финансового закрытия",
  };
  return NextResponse.json(
    { error: labels[error.message] ?? "Операция недоступна" },
    { status: 400 },
  );
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "deliver");
    const payload = { ...body, orderId };
    const requestHash = createRequestHash(payload);
    if (action === "financial-close") {
      return NextResponse.json(
        await closeOrderFinancially(
          {
            orderId,
            reason: String(body.reason ?? ""),
            idempotencyKey: idempotency.key,
            requestHash,
          },
          actor(auth.session!),
        ),
      );
    }
    if (action !== "deliver")
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    const completedAt = new Date(String(body.completedAt ?? ""));
    const allowedConsent = new Set(["YES", "NO", "UNKNOWN"]);
    const contactConsent = String(body.contactConsent ?? "UNKNOWN");
    const photoVideoConsent = String(body.photoVideoConsent ?? "UNKNOWN");
    if (
      Number.isNaN(completedAt.getTime()) ||
      !allowedConsent.has(contactConsent) ||
      !allowedConsent.has(photoVideoConsent)
    )
      return NextResponse.json({ error: "Проверьте данные сдачи" }, { status: 400 });
    return NextResponse.json(
      await completeDeliveredOrder(
        {
          orderId,
          completedAt,
          comment: typeof body.comment === "string" ? body.comment : undefined,
          clientAccepted: body.clientAccepted === true,
          contactConsent: contactConsent as "YES" | "NO" | "UNKNOWN",
          photoVideoConsent: photoVideoConsent as "YES" | "NO" | "UNKNOWN",
          idempotencyKey: idempotency.key,
          requestHash,
        },
        actor(auth.session!),
      ),
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return failure(error);
  }
}
