import { Prisma, Role } from "@prisma/client";

import { compareRequestHash } from "@/lib/idempotency";
import { normalizePhone } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

export class OrderDetailsError extends Error {}

export type OrderDetailsActor = {
  userId: number;
  role: Role;
  name: string;
};

export type OrderDetailsInput = {
  clientName: string;
  phone: string;
  whatsapp?: string;
  city: string;
  clientAddress?: string;
  iin?: string;
  clientComment?: string;
  orderAddress: string;
  mapUrl?: string;
  staircase: string;
  material: string;
  frameComment?: string;
  railingType?: string;
  supportType?: string;
  color?: string;
  lighting?: boolean;
  lightingDetails?: string;
  cladding?: boolean;
  claddingDetails?: string;
  additionalDetails?: string;
  paymentMethod?: string;
  orderReceivedAt?: Date;
  promisedAt?: Date | null;
  amount: Prisma.Decimal.Value;
  reason: string;
  idempotencyKey: string;
  requestHash: string;
};

const paymentIn = new Set(["CLIENT_PAYMENT", "payment", "PREPAYMENT", "ADDITIONAL_PAYMENT"]);

const clean = (value: string | undefined, max: number) =>
  (value ?? "").trim().slice(0, max);

function paidByClient(
  payments: Array<{ amount: Prisma.Decimal; type: string }>,
) {
  return payments.reduce((sum, payment) => {
    if (paymentIn.has(payment.type)) return sum.add(payment.amount);
    if (payment.type === "REFUND") return sum.sub(payment.amount);
    return sum;
  }, new Prisma.Decimal(0));
}

export async function updateOrderDetails(
  orderId: number,
  input: OrderDetailsInput,
  actor: OrderDetailsActor,
) {
  if (actor.role !== Role.DIRECTOR && actor.role !== Role.MANAGER)
    throw new OrderDetailsError("FORBIDDEN");
  const tenant = requireTenantIdentity().companyId;
  const phone = normalizePhone(input.phone);
  const whatsapp = input.whatsapp?.trim()
    ? normalizePhone(input.whatsapp)
    : phone;
  if (!phone || !whatsapp) throw new OrderDetailsError("INVALID_PHONE");
  const amount = new Prisma.Decimal(input.amount).toDecimalPlaces(2);
  if (!amount.isFinite() || amount.lte(0))
    throw new OrderDetailsError("INVALID_AMOUNT");
  const reason = clean(input.reason, 1000);
  if (!reason) throw new OrderDetailsError("REASON_REQUIRED");
  if (!clean(input.clientName, 300) || !clean(input.city, 200))
    throw new OrderDetailsError("CLIENT_FIELDS_REQUIRED");
  if (!clean(input.orderAddress, 1000) || !clean(input.material, 300) || !clean(input.staircase, 500))
    throw new OrderDetailsError("ORDER_FIELDS_REQUIRED");
  if (input.promisedAt && Number.isNaN(input.promisedAt.getTime()))
    throw new OrderDetailsError("INVALID_DATE");
  if (input.orderReceivedAt && Number.isNaN(input.orderReceivedAt.getTime()))
    throw new OrderDetailsError("INVALID_DATE");

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${orderId})`;
    const replay = await tx.orderEvent.findUnique({
      where: { idempotencyKey: `order-details:${input.idempotencyKey}` },
      select: { requestHash: true },
    });
    if (replay) {
      if (!compareRequestHash(replay.requestHash, input.requestHash))
        throw new OrderDetailsError("IDEMPOTENCY_CONFLICT");
      return { orderId, created: false };
    }
    const order = await tx.order.findFirst({
      where: {
        id: orderId,
        companyId: tenant,
        deletedAt: null,
        ...(actor.role === Role.MANAGER ? { managerUserId: actor.userId } : {}),
      },
      include: {
        client: true,
        payments: { where: { companyId: tenant }, select: { amount: true, type: true } },
        _count: {
          select: {
            documents: true,
            companyLedgerEntries: true,
            financeAuditEvents: true,
            commercialAdjustments: true,
          },
        },
      },
    });
    if (!order) throw new OrderDetailsError("ORDER_NOT_FOUND");

    const candidates = await tx.client.findMany({
      where: {
        companyId: tenant,
        id: { not: order.clientId },
        deletedAt: null,
        active: true,
      },
      select: { id: true, name: true, phone: true, whatsapp: true },
    });
    const duplicate = candidates.find(
      (client) =>
        normalizePhone(client.phone) === phone ||
        normalizePhone(client.whatsapp) === phone ||
        normalizePhone(client.phone) === whatsapp ||
        normalizePhone(client.whatsapp) === whatsapp,
    );
    if (duplicate)
      throw new OrderDetailsError(
        `DUPLICATE_CLIENT:${duplicate.id}:${duplicate.name}`,
      );

    const received = paidByClient(order.payments);
    if (amount.lt(received))
      throw new OrderDetailsError(`AMOUNT_BELOW_RECEIVED:${received.toString()}`);
    const amountChanged = !amount.eq(order.amount);
    const protectedCommercialHistory =
      order.payments.length > 0 ||
      order._count.documents > 0 ||
      order._count.companyLedgerEntries > 0 ||
      order._count.financeAuditEvents > 0 ||
      order._count.commercialAdjustments > 0;

    const beforeClient = {
      name: order.client.name,
      phone: order.client.phone,
      whatsapp: order.client.whatsapp,
      city: order.client.city,
      address: order.client.address,
      iin: order.client.iin,
    };
    await tx.client.update({
      where: { id: order.clientId },
      data: {
        name: clean(input.clientName, 300),
        phone,
        whatsapp,
        city: clean(input.city, 200),
        address: clean(input.clientAddress, 1000),
        iin: clean(input.iin, 32),
        comment: clean(input.clientComment, 2000),
      },
    });

    await tx.order.update({
      where: { id: order.id },
      data: {
        address: clean(input.orderAddress, 1000),
        mapUrl: clean(input.mapUrl, 2000),
        staircase: clean(input.staircase, 500),
        material: clean(input.material, 300),
        frameComment: clean(input.frameComment, 2000),
        railingType: clean(input.railingType, 500),
        supportType: clean(input.supportType, 500),
        color: clean(input.color, 300),
        lighting: input.lighting === true,
        lightingDetails: clean(input.lightingDetails, 1000),
        cladding: input.cladding === true,
        claddingDetails: clean(input.claddingDetails, 1000),
        additionalDetails: clean(input.additionalDetails, 3000),
        paymentMethod: clean(input.paymentMethod, 100),
        ...(input.orderReceivedAt ? { orderReceivedAt: input.orderReceivedAt } : {}),
        promisedAt: input.promisedAt ?? null,
        ...(amountChanged
          ? {
              amount,
              prepayment: received,
              balance: amount.sub(received),
              companyProfit: order.partnerAgreedAt
                ? amount.sub(order.partnerPrice)
                : new Prisma.Decimal(0),
            }
          : {}),
      },
    });

    await tx.leadActivity.create({
      data: {
        clientId: order.clientId,
        type: "CLIENT_DETAILS_UPDATED_FROM_ORDER",
        comment: `Данные клиента обновлены из заказа ${order.number}. Основание: ${reason}`,
        authorId: actor.userId,
        authorName: actor.name,
      },
    });
    if (amountChanged) {
      await tx.commercialAdjustment.create({
        data: {
          companyId: tenant,
          orderId: order.id,
          previousAmount: order.amount,
          newAmount: amount,
          balanceImpact: amount.sub(order.amount),
          reason,
          authorId: actor.userId,
          idempotencyKey: `order-details-adjustment:${input.idempotencyKey}`,
          requestHash: input.requestHash,
        },
      });
      await tx.financeAuditEvent.create({
        data: {
          orderId: order.id,
          action: protectedCommercialHistory
            ? "COMMERCIAL_ADJUSTMENT"
            : "ORDER_AMOUNT_EDITED_BEFORE_FINANCIAL_HISTORY",
          entityType: "Order",
          entityId: order.id,
          before: { amount: order.amount.toString(), received: received.toString() },
          after: { amount: amount.toString(), balance: amount.sub(received).toString() },
          reason,
          authorId: actor.userId,
        },
      });
    }
    await tx.orderEvent.create({
      data: {
        companyId: tenant,
        orderId: order.id,
        title: "Данные заказа обновлены",
        description: amountChanged
          ? `${order.amount.toString()} → ${amount.toString()} ₸ · ${reason}`
          : reason,
        user: actor.name,
        idempotencyKey: `order-details:${input.idempotencyKey}`,
        requestHash: input.requestHash,
      },
    });
    return {
      orderId: order.id,
      clientId: order.clientId,
      amountChanged,
      protectedCommercialHistory,
      clientBefore: beforeClient,
      created: true,
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 20_000,
  });
}
