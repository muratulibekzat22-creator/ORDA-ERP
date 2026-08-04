import { prisma } from "@/lib/prisma";

export async function getPayments() {
  return prisma.payment.findMany({
    include: {
      order: {
        include: {
          client: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getPayment(id: number) {
  return prisma.payment.findUnique({
    where: {
      id,
    },
    include: {
      order: {
        include: {
          client: true,
        },
      },
    },
  });
}

export async function createPayment(data: {
  orderId: number;
  amount: number;
  method: string;
  type: string;
  comment?: string;
  idempotencyKey?: string;
  requestHash?: string;
}) {
  return prisma.$transaction(async (tx) => {
    if(data.idempotencyKey&&data.requestHash){const existing=await tx.payment.findUnique({where:{idempotencyKey:data.idempotencyKey}});if(existing){if(existing.requestHash!==data.requestHash)throw new Error("IDEMPOTENCY_CONFLICT");return {payment:existing,order:await tx.order.findUniqueOrThrow({where:{id:existing.orderId}})};}}
    const order = await tx.order.findUnique({
      where: {
        id: data.orderId,
      },
    });

    if (!order) {
      return null;
    }

    if (data.amount > Number(order.balance)) {
      throw new Error("PAYMENT_EXCEEDS_BALANCE");
    }

    const prepayment = Number(order.prepayment) + data.amount;
    const balance = Math.max(Number(order.amount) - prepayment, 0);
    const isFullyPaid = balance <= 0;

    const payment = await tx.payment.create({
      data: {
        orderId: data.orderId,
        amount: data.amount,
        method: data.method,
        type: data.type,
        comment: data.comment,
        idempotencyKey:data.idempotencyKey,
        requestHash:data.requestHash,
      },
    });

    const updatedOrder = await tx.order.update({
      where: {
        id: order.id,
      },
      data: {
        prepayment: String(prepayment),
        balance: String(balance),
        ...(isFullyPaid ? { status: "Полностью оплачен" } : {}),
      },
    });

    const paymentDetails = [
      `${data.type}: ${data.amount.toLocaleString("ru-RU")} ₸`,
      data.method,
      data.comment,
    ]
      .filter(Boolean)
      .join(" • ");

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        title: isFullyPaid ? "Заказ полностью оплачен" : "Получена оплата",
        description: paymentDetails,
        user: "Система",
        idempotencyKey:data.idempotencyKey?`payment-event:${data.idempotencyKey}`:undefined,
        requestHash:data.requestHash,
      },
    });

    return {
      payment,
      order: updatedOrder,
    };
  });
}

export async function deletePayment(id: number) {
  return prisma.payment.delete({
    where: {
      id,
    },
  });
}

export async function getFinanceStats() {
  const payments = await prisma.payment.findMany();

  const income = payments.reduce(
    (sum, payment) => sum + payment.amount,
    0
  );

  const count = payments.length;

  const average =
    count > 0
      ? Math.round(income / count)
      : 0;

  return {
    income,
    count,
    average,
  };
}

export type FinanceFilters = {
  period?: "all" | "month" | "quarter" | "year";
  manager?: string;
  partnerId?: number;
  paymentStatus?: "all" | "debt" | "partial" | "paid";
};

export async function getFinanceDashboard(filters: FinanceFilters = {}) {
  const now = new Date();
  const startDate = new Date(now);

  if (filters.period === "month") startDate.setMonth(now.getMonth() - 1);
  if (filters.period === "quarter") startDate.setMonth(now.getMonth() - 3);
  if (filters.period === "year") startDate.setFullYear(now.getFullYear() - 1);

  const where = {
    ...(filters.period && filters.period !== "all" ? { createdAt: { gte: startDate } } : {}),
    ...(filters.manager ? { manager: filters.manager } : {}),
    ...(filters.partnerId ? { partnerId: filters.partnerId } : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    include: {
      client: true,
      partner: true,
      payments: true,
    },
    orderBy: { createdAt: "desc" },
  });

  const rows = orders.map((order) => {
    const amount = Number(order.amount);
    const received = order.payments.reduce((sum, payment) => sum + payment.amount, 0);
    const balance = Math.max(amount - received, 0);
    const paymentStatus = balance <= 0 ? "paid" : received > 0 ? "partial" : "debt";

    return {
      id: order.id,
      number: order.number,
      client: order.client.name,
      partner: order.partner?.name ?? "—",
      manager: order.manager,
      createdAt: order.createdAt,
      amount,
      prepayment: received,
      balance,
      partnerPrice: Number(order.partnerPrice),
      partnerPaid: Number(order.partnerPaid),
      partnerBalance: Number(order.partnerBalance),
      companyProfit: Number(order.companyProfit),
      paymentStatus,
    };
  });

  const filteredRows =
    filters.paymentStatus && filters.paymentStatus !== "all"
      ? rows.filter((row) => row.paymentStatus === filters.paymentStatus)
      : rows;

  const totals = filteredRows.reduce(
    (sum, row) => ({
      turnover: sum.turnover + row.amount,
      received: sum.received + row.prepayment,
      clientBalance: sum.clientBalance + row.balance,
      partnerPaid: sum.partnerPaid + row.partnerPaid,
      partnerBalance: sum.partnerBalance + row.partnerBalance,
      profit: sum.profit + row.companyProfit,
    }),
    { turnover: 0, received: 0, clientBalance: 0, partnerPaid: 0, partnerBalance: 0, profit: 0 }
  );

  const [managers, partners] = await Promise.all([
    prisma.order.findMany({ distinct: ["manager"], select: { manager: true }, orderBy: { manager: "asc" } }),
    prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  return {
    rows: filteredRows,
    totals,
    managers: managers.map((item) => item.manager),
    partners,
  };
}
