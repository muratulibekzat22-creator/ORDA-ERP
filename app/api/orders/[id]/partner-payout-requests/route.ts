import { PartnerSettlementOperationStatus, PartnerSettlementOperationType, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import {
  PartnerManagementError,
  requestPartnerPayoutForOrder,
  withdrawPartnerPayoutRequest,
} from "@/lib/services/partner-management.service";
import { requireTenantIdentity } from "@/lib/tenant-context";

type Context = { params: Promise<{ id: string }> };

function responseFor(error: unknown) {
  if (!(error instanceof PartnerManagementError))
    return NextResponse.json({ error: "Не удалось обработать заявку на оплату" }, { status: 500 });
  if (error.message === "FORBIDDEN")
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
  if (["RELATION_NOT_FOUND", "PAYOUT_REQUEST_NOT_FOUND"].includes(error.message))
    return NextResponse.json({ error: "Заказ или заявка не найдены" }, { status: 404 });
  if (error.message === "PAYOUT_EXCEEDS_PARTNER_BALANCE")
    return NextResponse.json({ error: "Сумма превышает остаток к выплате цеху" }, { status: 409 });
  return NextResponse.json({ error: "Проверьте сумму, дату и способ оплаты" }, { status: 400 });
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const orderId = Number((await params).id);
  const role = auth.session!.user.role as Role;
  if (!Number.isInteger(orderId) || (role !== Role.DIRECTOR && role !== Role.MANAGER))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const operations = await prisma.partnerSettlementOperation.findMany({
    where: {
      companyId: requireTenantIdentity().companyId,
      orderId,
      type: PartnerSettlementOperationType.COMPANY_TO_PARTNER,
      status: {
        in: [
          PartnerSettlementOperationStatus.PENDING,
          PartnerSettlementOperationStatus.REJECTED,
          PartnerSettlementOperationStatus.CANCELLED,
        ],
      },
      ...(role === Role.MANAGER
        ? { order: { managerUserId: Number(auth.session!.user.id) } }
        : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  return NextResponse.json(operations);
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.MANAGER)
    return NextResponse.json({ error: "Только менеджер заказа может сообщить об оплате" }, { status: 403 });
  const orderId = Number((await params).id);
  if (!Number.isInteger(orderId))
    return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const operationDate = new Date(String(body.operationDate ?? ""));
    const method = String(body.method ?? "").trim();
    if (Number.isNaN(operationDate.getTime()) || !method)
      return NextResponse.json({ error: "Укажите дату и способ оплаты" }, { status: 400 });
    const payload = {
      orderId,
      amount: Number(body.amount),
      operationDate: operationDate.toISOString(),
      method,
      account: String(body.account ?? ""),
      comment: String(body.comment ?? ""),
    };
    const result = await requestPartnerPayoutForOrder({
      ...payload,
      operationDate,
      idempotencyKey: idempotency.key,
      requestHash: createRequestHash(payload),
    }, {
      userId: Number(auth.session!.user.id),
      role: Role.MANAGER,
      name: auth.session!.user.name ?? "Менеджер",
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return responseFor(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const orderId = Number((await params).id);
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const operationId = Number(body.operationId);
  if (!Number.isInteger(orderId) || !Number.isInteger(operationId))
    return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  try {
    const result = await withdrawPartnerPayoutRequest(operationId, {
      userId: Number(auth.session!.user.id),
      role: Role.MANAGER,
      name: auth.session!.user.name ?? "Менеджер",
    });
    return NextResponse.json(result);
  } catch (error) {
    return responseFor(error);
  }
}
