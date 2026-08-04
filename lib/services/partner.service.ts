import { prisma } from "@/lib/prisma";

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
  return prisma.partner.delete({
    where: {
      id,
    },
  });
}