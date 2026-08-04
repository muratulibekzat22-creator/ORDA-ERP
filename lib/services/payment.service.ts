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
}) {
  const payment = await prisma.payment.create({
    data: {
      orderId: data.orderId,
      amount: data.amount,
      method: data.method,
      type: data.type,
      comment: data.comment,
    },
  });

  const order = await prisma.order.findUnique({
    where: {
      id: data.orderId,
    },
  });

  if (order) {
    const prepayment =
      Number(order.prepayment) + data.amount;

    const balance =
      Number(order.amount) - prepayment;

    await prisma.order.update({
      where: {
        id: order.id,
      },
      data: {
        prepayment: String(prepayment),
        balance: String(balance),
      },
    });
  }

  return payment;
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