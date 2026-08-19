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
}) {
  const result = await createFinanceOperation({
    ...data,
    type: "PARTNER_PAYOUT",
  });
  return result?.payment ?? null;
}

export async function assignPartnerToOrder(data: {
  orderId: number;
  partnerId: number;
  partnerPrice: number;
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
    const agreedAt = data.partnerAgreedAt ?? new Date();
    if (Number.isNaN(agreedAt.getTime()))
      throw new Error("INVALID_PARTNER_AGREEMENT_DATE");
    if (
      samePartner &&
      order.partnerAgreedAt &&
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
    const reason = data.reason?.trim() || "Partner assignment";
    if (data.partnerPrice < paid) throw new Error("PARTNER_PRICE_BELOW_PAID");
    const companyProfit = Number(order.amount) - data.partnerPrice;
    const updated = await tx.order.update({
      where: { id: order.id },
      data: {
        partnerId: partner.id,
        partnerPrice: String(data.partnerPrice),
        partnerAgreedAt: agreedAt,
        partnerPaid: String(paid),
        partnerBalance: String(data.partnerPrice - paid),
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
          newPayable: String(data.partnerPrice),
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
            partnerPrice: String(data.partnerPrice),
            partnerAgreedAt: agreedAt.toISOString(),
            partnerPaid: String(paid),
            partnerBalance: String(data.partnerPrice - paid),
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
        description: `${partner.name} • ${data.partnerPrice.toLocaleString("ru-RU")} ₸`,
        user: data.manager ?? order.manager,
      },
    });
    return updated;
  });
}
