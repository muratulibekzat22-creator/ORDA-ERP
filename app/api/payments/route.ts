import { NextResponse } from "next/server";
import {
  createPayment,
  getPayments,
} from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { compareRequestHash, createRequestHash, idempotencyConflict, isPrismaUniqueConflict, readIdempotencyKey } from "@/lib/idempotency";

export async function GET() {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  try {
    const partner = auth.session!.user.role === Role.PARTNER ? await prisma.partner.findUnique({ where: { userId: Number(auth.session!.user.id) }, select: { id: true } }) : null;
    if (auth.session!.user.role === Role.PARTNER && !partner)
      return NextResponse.json({ error: "Профиль цеха не найден" }, { status: 404 });
    const payments = partner
      ? await prisma.payment.findMany({
          where: {
            type: "PARTNER_PAYOUT",
            order: { partnerId: partner.id },
          },
          select: {
            id: true,
            amount: true,
            type: true,
            method: true,
            comment: true,
            operationDate: true,
            order: { select: { id: true, number: true } },
          },
          orderBy: { operationDate: "desc" },
        })
      : await getPayments();

    return NextResponse.json(payments);
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error: "Ошибка получения платежей",
      },
      {
        status: 500,
      }
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER)
    return NextResponse.json(
      { error: "Цех не может создавать финансовые операции" },
      { status: 403 },
    );
  const idempotency=readIdempotencyKey(req);if("response" in idempotency)return idempotency.response;
  let hash = "";
  try {
    const body: unknown = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        {
          error: "Некорректные данные оплаты",
        },
        {
          status: 400,
        }
      );
    }

    const values = body as Record<string, unknown>;
    const orderId = Number(values.orderId);
    const amount = Number(values.amount);
    hash=createRequestHash({orderId,amount,type:values.type,method:values.method,comment:values.comment??null});

    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json(
        {
          error: "Укажите корректные сумму и заказ",
        },
        {
          status: 400,
        }
      );
    }

    if (auth.session!.user.role === Role.PARTNER) {
      const partner = await prisma.partner.findUnique({ where: { userId: Number(auth.session!.user.id) }, select: { id: true } });
      if (!partner || !await prisma.order.findFirst({ where: { id: orderId, partnerId: partner.id }, select: { id: true } })) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    if (values.type !== "Предоплата" && values.type !== "Доплата") {
      return NextResponse.json({ error: "Некорректный тип оплаты" }, { status: 400 });
    }

    if (
      values.method !== "Наличные" &&
      values.method !== "Kaspi" &&
      values.method !== "Банковский перевод"
    ) {
      return NextResponse.json({ error: "Некорректный способ оплаты" }, { status: 400 });
    }

    const payment = await createPayment({
      orderId,
      amount,
      type: values.type,
      method: values.method,
      comment: typeof values.comment === "string" ? values.comment.trim() || undefined : undefined,
      author: auth.session!.user.name ?? "System",
      idempotencyKey:idempotency.key,
      requestHash:hash,
    });

    if (!payment) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    return NextResponse.json(payment);
  } catch (error) {
    console.error(error);

    if (error instanceof Error && error.message === "PAYMENT_EXCEEDS_BALANCE") {
      return NextResponse.json({ error: "Оплата превышает остаток заказа" }, { status: 409 });
    }
    if(error instanceof Error&&error.message==="IDEMPOTENCY_CONFLICT")return idempotencyConflict();
    if(isPrismaUniqueConflict(error)){const existing=await prisma.payment.findUnique({where:{idempotencyKey:idempotency.key}});if(existing&&existing.orderId&&compareRequestHash(existing.requestHash,hash))return NextResponse.json({payment:existing,order:await prisma.order.findUniqueOrThrow({where:{id:existing.orderId}})});return idempotencyConflict();}

    return NextResponse.json(
      {
        error: "Ошибка создания платежа",
      },
      {
        status: 500,
      }
    );
  }
}
