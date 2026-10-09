import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import {
  createPayment,
  getPayments,
} from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { compareRequestHash, createRequestHash, idempotencyConflict, isPrismaUniqueConflict, readIdempotencyKey } from "@/lib/idempotency";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { enterTenantFromSession } from "@/lib/tenant-context";

export async function GET(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  try {
    const partner = auth.session!.user.role === Role.PARTNER ? await prisma.partner.findUnique({ where: { userId: Number(auth.session!.user.id) }, select: { id: true } }) : null;
    if (auth.session!.user.role === Role.PARTNER && !partner)
      return NextResponse.json({ error: "Профиль цеха не найден" }, { status: 404 });
    const params = new URL(request.url).searchParams;
    const requestedOrderId = params.get("orderId") ? Number(params.get("orderId")) : undefined;
    if (requestedOrderId !== undefined && (!Number.isInteger(requestedOrderId) || requestedOrderId <= 0))
      return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
    const payments = partner
      ? await prisma.payment.findMany({
          where: {
            type: "PARTNER_PAYOUT",
            order: { partnerId: partner.id, deletedAt: null },
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
      : await getPayments({
          ...(requestedOrderId ? { orderId: requestedOrderId } : {}),
          ...(auth.session!.user.role === Role.MANAGER
            ? { managerUserId: Number(auth.session!.user.id) }
            : {}),
        });

    const visiblePayments = auth.session!.user.role === Role.MANAGER
      ? payments.filter((item) => ["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT", "REFUND"].includes(item.type))
      : payments;
    return NextResponse.json(visiblePayments);
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
  const session = await getServerSession(authOptions);
  if (!session?.user || !enterTenantFromSession(session)) return NextResponse.json({ error: "Сессия завершена", code: "SESSION_INVALID" }, { status: 401 });
  const user = session.user;
  const role = user.role as Role;
  if (user.role === Role.PARTNER)
    return NextResponse.json(
      { error: "Цех не может создавать финансовые операции" },
      { status: 403 },
    );
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR && role !== Role.MANAGER && role !== Role.ACCOUNTANT)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
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
    const allowedMethods = new Set(["Наличные", "Kaspi", "Kaspi перевод", "Kaspi рассрочка", "Банковский перевод", "Банковская карта", "Карта", "Другое"]);
    const rawParts = values.parts;
    const parts = Array.isArray(rawParts) ? rawParts.map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      const part = raw as Record<string, unknown>;
      const partAmount = Number(part.amount);
      const method = typeof part.method === "string" ? part.method.trim() : "";
      const reference = typeof part.reference === "string" ? part.reference.trim().slice(0, 160) : undefined;
      if (!allowedMethods.has(method) || !Number.isFinite(partAmount) || partAmount <= 0 || Math.abs(partAmount * 100 - Math.round(partAmount * 100)) > 1e-7) return null;
      return { method, amount: partAmount, reference };
    }) : undefined;
    hash=createRequestHash({orderId,amount,type:values.type,method:values.method,parts,comment:values.comment??null});

    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0 || Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 || (parts && (!parts.length || parts.some((part) => !part)))) {
      return NextResponse.json(
        {
          error: "Укажите корректные сумму и заказ",
        },
        {
          status: 400,
        }
      );
    }

    const ownedOrder = await prisma.order.findFirst({ where: { id: orderId, deletedAt: null, ...(role === Role.MANAGER ? { managerUserId: Number(session.user.id) } : {}) }, select: { id: true } });
    if (!ownedOrder) return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });

    if (values.type !== "Предоплата" && values.type !== "Доплата") {
      return NextResponse.json({ error: "Некорректный тип оплаты" }, { status: 400 });
    }

    const method = parts && parts.length > 1 ? "MIXED" : parts?.[0]?.method ?? values.method;
    if (typeof method !== "string" || (method !== "MIXED" && !allowedMethods.has(method))) {
      return NextResponse.json({ error: "Некорректный способ оплаты" }, { status: 400 });
    }

    const payment = await createPayment({
      orderId,
      amount,
      type: values.type,
      method,
      parts: parts?.filter((part): part is NonNullable<typeof part> => Boolean(part)),
      comment: typeof values.comment === "string" ? values.comment.trim() || undefined : undefined,
      author: session.user.name ?? "System",
      authorId: Number(session.user.id),
      idempotencyKey:idempotency.key,
      requestHash:hash,
    });

    if (!payment) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
    }

    const receipt = await prisma.paymentReceipt.findUnique({
      where: { paymentId: payment.payment.id },
      select: {
        id: true,
        displayNumber: true,
        verificationToken: true,
        publicAccessEnabled: true,
        documentId: true,
        document: {
          select: {
            currentVersion: true,
            versions: {
              select: { id: true, version: true, fileName: true },
              orderBy: { version: "desc" },
              take: 1,
            },
          },
        },
      },
    });
    return NextResponse.json({
      payment: {
        id: payment.payment.id,
        amount: payment.payment.amount,
        method: payment.payment.method,
        operationDate: payment.payment.operationDate,
      },
      order: payment.order ? {
        id: payment.order.id,
        amount: payment.order.amount,
        prepayment: payment.order.prepayment,
        balance: payment.order.balance,
      } : null,
      receiptPdfStatus: "receiptPdfStatus" in payment ? payment.receiptPdfStatus : undefined,
      receipt,
    });
  } catch (error) {
    console.error(error);

    if (error instanceof Error && error.message === "PAYMENT_EXCEEDS_BALANCE") {
      return NextResponse.json({ error: "Оплата превышает остаток заказа" }, { status: 409 });
    }
    if (error instanceof Error && ["INVALID_AMOUNT", "INVALID_PAYMENT_PARTS", "PAYMENT_PARTS_MISMATCH"].includes(error.message)) {
      return NextResponse.json({ error: error.message === "PAYMENT_PARTS_MISMATCH" ? "Сумма частей не совпадает с суммой платежа" : "Некорректная разбивка оплаты" }, { status: 400 });
    }
    if (error instanceof Error && error.message === "RESPONSIBLE_MANAGER_REQUIRED") {
      return NextResponse.json(
        { error: "Назначьте активного ответственного менеджера для формирования квитанции" },
        { status: 409 },
      );
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
