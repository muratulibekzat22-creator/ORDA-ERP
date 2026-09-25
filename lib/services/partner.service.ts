import { PartnerPayoutPurpose, Prisma, Role } from "@prisma/client";
import { compareRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { createFinanceOperation } from "@/lib/services/payment.service";

type PartnerOrderStatsSource = {
  amount: unknown;
  partnerPrice: unknown;
  partnerAgreedAt: Date | null;
  partnerPaid: unknown;
  partnerBalance: unknown;
  lifecycle: string;
};

function partnerStats(orders: PartnerOrderStatsSource[]) {
  const financialOrders = orders.filter(
    (order) => order.lifecycle !== "CANCELLED",
  );
  const agreedOrders = financialOrders.filter(
    (order) => order.partnerAgreedAt !== null,
  );
  const partnerAgreed = agreedOrders.reduce(
    (sum, order) => sum + Number(order.partnerPrice),
    0,
  );
  const partnerPaid = agreedOrders.reduce(
    (sum, order) => sum + Number(order.partnerPaid),
    0,
  );
  const partnerBalance = agreedOrders.reduce(
    (sum, order) => sum + Math.max(Number(order.partnerBalance), 0),
    0,
  );
  const grossMargin = agreedOrders.reduce(
    (sum, order) => sum + Number(order.amount) - Number(order.partnerPrice),
    0,
  );
  return {
    totalOrders: financialOrders.length,
    activeOrders: financialOrders.filter(
      (order) => order.lifecycle !== "COMPLETED",
    ).length,
    partnerAgreed,
    partnerPaid,
    partnerBalance,
    grossMargin,
    // Compatibility aliases for existing consumers while the UI moves to canonical labels.
    totalAmount: partnerAgreed,
    companyProfit: grossMargin,
  };
}

export async function getPartners(options: { includeArchived?: boolean } = {}) {
  const partners = await prisma.partner.findMany({
    where: options.includeArchived
      ? { isTest: false, managementDirectory: false }
      : { active: true, archived: false, isTest: false, managementDirectory: false },
    include: {
      orders: {
        include: {
          client: true,
          payments: true,
          productions: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      name: "asc",
    },
  });

  return partners.map((partner) => ({
    ...partner,
    stats: partnerStats(partner.orders),
  }));
}

export async function getPartner(id: number) {
  const partner = await prisma.partner.findFirst({
    where: {
      id,
      isTest: false,
      managementDirectory: false,
    },
    include: {
      orders: {
        include: {
          client: true,
          payments: true,
          productions: true,
          measurements: true,
          events: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });

  if (!partner) {
    return null;
  }

  return {
    ...partner,
    stats: partnerStats(partner.orders),
  };
}

export async function createPartner(data: {
  name: string;
  phone?: string;
  city?: string;
  email?: string;
}) {
  return prisma.partner.create({
    data: {
      ...data,
      active: true,
      archived: false,
      isTest: false,
    },
  });
}

export async function updatePartner(
  id: number,
  data: {
    name: string;
    phone?: string;
    city?: string;
    email?: string;
    active?: boolean;
  },
) {
  const partner = await prisma.partner.findFirst({ where: { id, managementDirectory: false }, select: { id: true } });
  if (!partner) throw new Error("PARTNER_NOT_FOUND");
  return prisma.partner.update({
    where: {
      id,
    },
    data: {
      ...data,
      ...(typeof data.active === "boolean" ? { archived: !data.active } : {}),
    },
  });
}

export async function deletePartner(id: number) {
  const partner = await prisma.partner.findFirst({ where: { id, managementDirectory: false }, select: { id: true } });
  if (!partner) throw new Error("PARTNER_NOT_FOUND");
  const orders = await prisma.order.count({
    where: { partnerId: id, deletedAt: null },
  });

  if (orders > 0) {
    throw new Error(
      "Нельзя удалить партнёра, пока у него есть связанные заказы",
    );
  }

  return prisma.partner.delete({
    where: {
      id,
    },
  });
}

export async function payPartner(data: {
  orderId: number;
  amount: number;
  method: string;
  comment?: string;
  author?: string;
  authorId?: number;
  operationDate?: Date;
  idempotencyKey?: string;
  requestHash?: string;
  partnerPayoutPurpose?: PartnerPayoutPurpose;
}) {
  const result = await createFinanceOperation({
    ...data,
    type: "PARTNER_PAYOUT",
  });
  return result?.payment ?? null;
}

export async function setProductionPrice(data: {
  orderId: number;
  amount: number;
  actor: { id: number; name: string; role: Role };
  idempotencyKey: string;
  requestHash: string;
}) {
  if (
    data.actor.role !== Role.DIRECTOR &&
    data.actor.role !== Role.MANAGER
  )
    throw new Error("FORBIDDEN");
  if (!Number.isFinite(data.amount) || data.amount <= 0)
    throw new Error("INVALID_PRODUCTION_PRICE");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${data.orderId})`;
    const eventKey = `production-price:${data.orderId}:${data.idempotencyKey}`;
    const replay = await tx.orderEvent.findUnique({
      where: { idempotencyKey: eventKey },
      select: { requestHash: true },
    });
    if (replay) {
      if (!compareRequestHash(replay.requestHash, data.requestHash))
        throw new Error("IDEMPOTENCY_CONFLICT");
      return {
        order: await tx.order.findUniqueOrThrow({ where: { id: data.orderId } }),
        created: false,
      };
    }
    const order = await tx.order.findFirst({
      where: { id: data.orderId, deletedAt: null },
    });
    if (!order) throw new Error("ORDER_NOT_FOUND");
    if (data.amount < Number(order.partnerPaid))
      throw new Error("PRODUCTION_PRICE_BELOW_PAID");
    const wasSet = order.partnerAgreedAt !== null;
    const agreedAt = new Date();
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        partnerPrice: new Prisma.Decimal(data.amount),
        partnerAgreedAt: agreedAt,
        partnerBalance: new Prisma.Decimal(data.amount).sub(order.partnerPaid),
        companyProfit: order.amount.sub(data.amount),
      },
    });
    await tx.financeAuditEvent.create({
      data: {
        orderId: order.id,
        action: wasSet ? "PRODUCTION_PRICE_CHANGED" : "PRODUCTION_PRICE_SET",
        entityType: "Order",
        entityId: order.id,
        before: {
          productionPrice: wasSet ? order.partnerPrice.toString() : null,
          setAt: order.partnerAgreedAt?.toISOString() ?? null,
        },
        after: {
          productionPrice: updated.partnerPrice.toString(),
          setAt: agreedAt.toISOString(),
        },
        reason: "Цена производства обновлена",
        authorId: data.actor.id,
      },
    });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        title: wasSet
          ? "Цена производства изменена"
          : "Цена производства указана",
        description: `${data.amount.toLocaleString("ru-RU")} ₸`,
        user: data.actor.name,
        idempotencyKey: eventKey,
        requestHash: data.requestHash,
      },
    });
    return { order: updated, created: true };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function assignPartnerToOrder(data: {
  orderId: number;
  partnerId: number;
  partnerPrice?: number;
  partnerAgreedAt?: Date;
  manager?: string;
  authorId?: number;
  reason?: string;
  directorConfirmed?: boolean;
}) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${data.orderId})`;
    const order = await tx.order.findFirst({
      where: { id: data.orderId, deletedAt: null },
    });
    const partner = await tx.partner.findFirst({
      where: {
        id: data.partnerId,
        active: true,
        archived: false,
        isTest: false,
        managementDirectory: false,
      },
    });
    if (!order || !partner) return null;
    const previousPayouts = await tx.payment.aggregate({
      where: { orderId: order.id, type: "PARTNER_PAYOUT" },
      _sum: { amount: true },
      _count: true,
    });
    const newPartnerPayouts = await tx.payment.aggregate({
      where: {
        orderId: order.id,
        partnerId: partner.id,
        type: "PARTNER_PAYOUT",
      },
      _sum: { amount: true },
    });
    const previousPaid = Number(previousPayouts._sum.amount ?? 0),
      paid = Number(newPartnerPayouts._sum.amount ?? 0);
    const samePartner = order.partnerId === partner.id;
    const priceSet =
      data.partnerPrice !== undefined &&
      Number.isFinite(data.partnerPrice) &&
      data.partnerPrice > 0;
    if (
      data.partnerPrice !== undefined &&
      (!Number.isFinite(data.partnerPrice) || data.partnerPrice < 0)
    )
      throw new Error("INVALID_PARTNER_PRICE");
    const agreedAt = priceSet ? (data.partnerAgreedAt ?? new Date()) : null;
    if (agreedAt && Number.isNaN(agreedAt.getTime()))
      throw new Error("INVALID_PARTNER_AGREEMENT_DATE");
    if (samePartner && data.partnerPrice === undefined)
      return order;
    if (
      samePartner &&
      order.partnerAgreedAt &&
      agreedAt &&
      Number(order.partnerPrice) === data.partnerPrice &&
      order.partnerAgreedAt.getTime() === agreedAt.getTime()
    )
      return order;
    if (
      order.partnerId !== null &&
      order.partnerId !== partner.id &&
      previousPayouts._count > 0 &&
      !data.directorConfirmed
    )
      throw new Error("DIRECTOR_CONFIRMATION_REQUIRED");
    const reason = data.reason?.trim() || "Цех назначен";
    if (!priceSet && paid > 0) throw new Error("PARTNER_PRICE_REQUIRED");
    const partnerPrice = priceSet ? data.partnerPrice! : 0;
    if (partnerPrice < paid) throw new Error("PARTNER_PRICE_BELOW_PAID");
    const companyProfit = priceSet ? Number(order.amount) - partnerPrice : 0;
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        partnerId: partner.id,
        partnerPrice: String(partnerPrice),
        partnerAgreedAt: agreedAt,
        partnerPaid: String(paid),
        partnerBalance: String(partnerPrice - paid),
        companyProfit: String(companyProfit),
      },
    });
    if (data.authorId) {
      await tx.partnerAssignmentHistory.create({
        data: {
          orderId: order.id,
          previousPartnerId: order.partnerId,
          newPartnerId: partner.id,
          previousPayable: order.partnerPrice,
          newPayable: String(partnerPrice),
          paidAtChange: String(previousPaid),
          remainingAtChange: String(
            Math.max(Number(order.partnerPrice) - previousPaid, 0),
          ),
          reason,
          authorId: data.authorId,
        },
      });
      await tx.financeAuditEvent.create({
        data: {
          orderId: order.id,
          action:
            order.partnerId === null
              ? "PARTNER_ASSIGNED"
              : samePartner
                ? "PARTNER_AGREED_AMOUNT_CHANGED"
                : "PARTNER_REASSIGNED",
          entityType: "Order",
          entityId: order.id,
          before: {
            partnerId: order.partnerId,
            partnerPrice: String(order.partnerPrice),
            partnerAgreedAt: order.partnerAgreedAt?.toISOString() ?? null,
            partnerPaid: String(order.partnerPaid),
            partnerBalance: String(order.partnerBalance),
          },
          after: {
            partnerId: partner.id,
            partnerPrice: String(partnerPrice),
            partnerAgreedAt: agreedAt?.toISOString() ?? null,
            partnerPaid: String(paid),
            partnerBalance: String(partnerPrice - paid),
          },
          reason,
          authorId: data.authorId,
        },
      });
    }
    const production = await tx.production.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: "desc" },
    });
    if (production)
      await tx.production.update({
        where: { id: production.id },
        data: { stage: "Дерево" },
      });
    else
      await tx.production.create({
        data: { orderId: order.id, stage: "Дерево", percent: 0, master: "" },
      });
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        title: "Передан партнёру",
        description: priceSet
          ? `${partner.name} • ${partnerPrice.toLocaleString("ru-RU")} ₸`
          : partner.name,
        user: data.manager ?? order.manager,
      },
    });
    return updated;
  });
}
