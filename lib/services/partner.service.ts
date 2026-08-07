import { prisma } from "@/lib/prisma";
import { createFinanceOperation } from "@/lib/services/payment.service";

export async function getPartners() {
  const partners = await prisma.partner.findMany({
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

  return partners.map((partner) => {
    const totalOrders = partner.orders.length;

    const totalAmount = partner.orders.reduce(
      (sum, order) => sum + Number(order.amount),
      0
    );

    const partnerPaid = partner.orders.reduce(
      (sum, order) => sum + Number(order.partnerPaid),
      0
    );

    const partnerBalance = partner.orders.reduce(
      (sum, order) => sum + Number(order.partnerBalance),
      0
    );

    const companyProfit = partner.orders.reduce(
      (sum, order) => sum + Number(order.companyProfit),
      0
    );

    return {
      ...partner,
      stats: {
        totalOrders,
        totalAmount,
        partnerPaid,
        partnerBalance,
        companyProfit,
      },
    };
  });
}

export async function getPartner(id: number) {
  const partner = await prisma.partner.findUnique({
    where: {
      id,
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

  const totalAmount = partner.orders.reduce(
    (sum, order) => sum + Number(order.amount),
    0
  );

  const partnerPaid = partner.orders.reduce(
    (sum, order) => sum + Number(order.partnerPaid),
    0
  );

  const partnerBalance = partner.orders.reduce(
    (sum, order) => sum + Number(order.partnerBalance),
    0
  );

  const companyProfit = partner.orders.reduce(
    (sum, order) => sum + Number(order.companyProfit),
    0
  );

  return {
    ...partner,
    stats: {
      totalOrders: partner.orders.length,
      totalAmount,
      partnerPaid,
      partnerBalance,
      companyProfit,
    },
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
  }
) {
  return prisma.partner.update({
    where: {
      id,
    },
    data,
  });
}

export async function deletePartner(id: number) {
  const orders = await prisma.order.count({ where: { partnerId: id } });

  if (orders > 0) {
    throw new Error("Нельзя удалить партнёра, пока у него есть связанные заказы");
  }

  return prisma.partner.delete({
    where: {
      id,
    },
  });
}

export async function payPartner(data: { orderId: number; amount: number; method: string; comment?: string; author?: string; idempotencyKey?:string; requestHash?:string }) {
  const result = await createFinanceOperation({ ...data, type: "PARTNER_PAYOUT" });
  return result?.payment ?? null;
}

export async function assignPartnerToOrder(data: { orderId: number; partnerId: number; partnerPrice: number; manager?: string; authorId?: number; reason?: string; directorConfirmed?: boolean }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT TRUE AS locked FROM pg_advisory_xact_lock(${data.orderId})`;
    const order = await tx.order.findUnique({ where: { id: data.orderId } });
    const partner = await tx.partner.findUnique({ where: { id: data.partnerId } });
    if (!order || !partner) return null;
    const previousPayouts = await tx.payment.aggregate({ where: { orderId: order.id, type: "PARTNER_PAYOUT" }, _sum: { amount: true }, _count: true });
    const newPartnerPayouts = await tx.payment.aggregate({ where: { orderId: order.id, partnerId: partner.id, type: "PARTNER_PAYOUT" }, _sum: { amount: true } });
    const previousPaid = Number(previousPayouts._sum.amount ?? 0), paid = Number(newPartnerPayouts._sum.amount ?? 0);
    if (order.partnerId !== null && order.partnerId !== partner.id && previousPayouts._count > 0 && !data.directorConfirmed) throw new Error("DIRECTOR_CONFIRMATION_REQUIRED");
    const reason = data.reason?.trim() || "Partner assignment";
    if (data.partnerPrice < paid) throw new Error("PARTNER_PRICE_BELOW_PAID");
    const companyProfit = Number(order.amount) - data.partnerPrice;
    const updated = await tx.order.update({ where: { id: order.id }, data: { partnerId: partner.id, partnerPrice: String(data.partnerPrice), partnerPaid: String(paid), partnerBalance: String(data.partnerPrice - paid), companyProfit: String(companyProfit) } });
    if (data.authorId) {
      await tx.partnerAssignmentHistory.create({ data: { orderId: order.id, previousPartnerId: order.partnerId, newPartnerId: partner.id, previousPayable: order.partnerPrice, newPayable: String(data.partnerPrice), paidAtChange: String(previousPaid), remainingAtChange: String(Math.max(Number(order.partnerPrice) - previousPaid, 0)), reason, authorId: data.authorId } });
      await tx.financeAuditEvent.create({ data: { orderId: order.id, action: "PARTNER_REASSIGNMENT", entityType: "Order", entityId: order.id, before: { partnerId: order.partnerId, partnerPrice: String(order.partnerPrice), partnerPaid: String(order.partnerPaid), partnerBalance: String(order.partnerBalance) }, after: { partnerId: partner.id, partnerPrice: String(data.partnerPrice), partnerPaid: String(paid), partnerBalance: String(data.partnerPrice - paid) }, reason, authorId: data.authorId } });
    }
    const production = await tx.production.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    if (production) await tx.production.update({ where: { id: production.id }, data: { stage: "Дерево" } });
    else await tx.production.create({ data: { orderId: order.id, stage: "Дерево", percent: 0, master: "" } });
    await tx.orderEvent.create({ data: { orderId: order.id, title: "Передан партнёру", description: `${partner.name} • ${data.partnerPrice.toLocaleString("ru-RU")} ₸`, user: data.manager ?? order.manager } });
    return updated;
  });
}
