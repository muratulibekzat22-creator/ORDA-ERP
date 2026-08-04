import { prisma } from "@/lib/prisma";

export async function getOrders() {
  return prisma.order.findMany({
    include: {
      client: true,
      partner: true,
      measurements: true,
      payments: true,
      productions: true,
      events: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getOrder(id: number) {
  return prisma.order.findUnique({
    where: {
      id,
    },
    include: {
      client: true,
      partner: true,
      measurements: true,
      payments: true,
      productions: true,
      events: {
        orderBy: {
          createdAt: "desc",
        },
      },
    },
  });
}

export async function createOrder(data: {
  number: string;
  clientId: number;

  partnerId?: number | null;

  address: string;
  staircase: string;
  material: string;

  amount: string;
  prepayment: string;
  balance: string;

  partnerPrice: string;
  companyProfit: string;
  partnerPaid: string;
  partnerBalance: string;

  manager: string;
  status: string;
}) {
  const order = await prisma.order.create({
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      title: "Создан заказ",
      description: `Заказ ${order.number} успешно создан.`,
      user: data.manager,
    },
  });

  return order;
}

export async function updateOrder(
  id: number,
  data: {
    number: string;
    clientId: number;

    partnerId?: number | null;

    address: string;
    staircase: string;
    material: string;

    amount: string;
    prepayment: string;
    balance: string;

    partnerPrice: string;
    companyProfit: string;
    partnerPaid: string;
    partnerBalance: string;

    manager: string;
    status: string;
  }
) {
  const order = await prisma.order.update({
    where: {
      id,
    },
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: id,
      title: "Обновление заказа",
      description: "Карточка заказа была изменена.",
      user: data.manager,
    },
  });

  return order;
}

export async function deleteOrder(id: number) {
  await prisma.orderEvent.deleteMany({
    where: {
      orderId: id,
    },
  });

  return prisma.order.delete({
    where: {
      id,
    },
  });
}
export async function addPayment(data: {
  orderId: number;
  amount: number;
  method: string;
  type: string;
  comment?: string;
}) {
  const payment = await prisma.payment.create({
    data,
  });

  await prisma.order.update({
    where: {
      id: data.orderId,
    },
    data: {
      prepayment: {
        increment: data.amount,
      },
      balance: {
        decrement: data.amount,
      },
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: data.orderId,
      title: "Поступила оплата",
      description: `${data.amount.toLocaleString()} ₸`,
      user: "ERP",
    },
  });

  return payment;
}

export async function addMeasurement(data: {
  orderId: number;
  measurer: string;
  visitDate: Date;
  floorHeight?: number;
  staircaseWidth?: number;
  stepsCount?: number;
  comment?: string;
}) {
  const measurement = await prisma.measurement.create({
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: data.orderId,
      title: "Добавлен замер",
      description: data.comment,
      user: data.measurer,
    },
  });

  return measurement;
}

export async function addProduction(data: {
  orderId: number;
  stage: string;
  percent: number;
  master: string;
  comment?: string;
}) {
  const production = await prisma.production.create({
    data,
  });

  await prisma.orderEvent.create({
    data: {
      orderId: data.orderId,
      title: "Производство",
      description: `${data.stage} (${data.percent}%)`,
      user: data.master,
    },
  });

  return production;
}

export async function addOrderEvent(data: {
  orderId: number;
  title: string;
  description?: string;
  user?: string;
}) {
  return prisma.orderEvent.create({
    data,
  });
}