import { prisma } from "@/lib/prisma";
import { compareRequestHash, isPrismaUniqueConflict } from "@/lib/idempotency";

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
  try { return await prisma.$transaction(async (tx) => {
    if(data.idempotencyKey&&data.requestHash){const existing=await tx.payment.findUnique({where:{idempotencyKey:data.idempotencyKey}});if(existing){if(existing.requestHash!==data.requestHash)throw new Error("IDEMPOTENCY_CONFLICT");return existing;}}
    const order = await tx.order.findUnique({ where: { id: data.orderId }, select: { id: true, partnerId: true, partnerPaid: true, partnerBalance: true } });
    if (!order || !order.partnerId) return null;
    if (data.amount > Number(order.partnerBalance)) throw new Error("PARTNER_PAYMENT_EXCEEDS_BALANCE");
    const payment = await tx.payment.create({ data: { orderId: data.orderId, partnerId: order.partnerId, amount: data.amount, type: "PARTNER_PAYOUT", method: data.method, comment: data.comment,author:data.author,idempotencyKey:data.idempotencyKey,requestHash:data.requestHash } });
    const partnerPaid = Number(order.partnerPaid) + data.amount;
    const partnerBalance = Math.max(Number(order.partnerBalance) - data.amount, 0);
    await tx.order.update({ where: { id: order.id }, data: { partnerPaid: String(partnerPaid), partnerBalance: String(partnerBalance) } });
    await tx.orderEvent.create({ data: { orderId: order.id, title: "Выплата партнёру", description: `${data.amount.toLocaleString("ru-RU")} ₸ • ${data.method}${data.comment ? ` • ${data.comment}` : ""}`, user: "Система",idempotencyKey:data.idempotencyKey?`partner-event:${data.idempotencyKey}`:undefined,requestHash:data.requestHash } });
    return payment;
  }); } catch(error) { if(isPrismaUniqueConflict(error)&&data.idempotencyKey&&data.requestHash){const existing=await prisma.payment.findUnique({where:{idempotencyKey:data.idempotencyKey}});if(existing&&compareRequestHash(existing.requestHash,data.requestHash))return existing;throw new Error("IDEMPOTENCY_CONFLICT");}throw error; }
}

export async function assignPartnerToOrder(data: { orderId: number; partnerId: number; partnerPrice: number; manager?: string }) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: data.orderId } });
    const partner = await tx.partner.findUnique({ where: { id: data.partnerId } });
    if (!order || !partner) return null;
    const companyProfit = Number(order.amount) - data.partnerPrice;
    const updated = await tx.order.update({ where: { id: order.id }, data: { partnerId: partner.id, partnerPrice: String(data.partnerPrice), partnerBalance: String(data.partnerPrice), companyProfit: String(companyProfit), status: "Заготовка" } });
    const production = await tx.production.findFirst({ where: { orderId: order.id }, orderBy: { createdAt: "desc" } });
    if (production) await tx.production.update({ where: { id: production.id }, data: { stage: "Заготовка" } });
    else await tx.production.create({ data: { orderId: order.id, stage: "Заготовка", percent: 0, master: "" } });
    await tx.orderEvent.create({ data: { orderId: order.id, title: "Передан партнёру", description: `${partner.name} • ${data.partnerPrice.toLocaleString("ru-RU")} ₸`, user: data.manager ?? order.manager } });
    return updated;
  });
}
