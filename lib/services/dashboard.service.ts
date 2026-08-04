import { prisma } from "@/lib/prisma";

export async function getDashboard() {
  const [
    clients,
    orders,
    productions,
    payments,
  ] = await Promise.all([
    prisma.client.findMany(),
    prisma.order.findMany({
      include: {
        client: true,
      },
    }),
    prisma.production.findMany({
      include: {
        order: {
          include: {
            client: true,
          },
        },
      },
    }),
    prisma.payment.findMany(),
  ]);

  const totalRevenue = orders.reduce(
    (sum, order) => sum + Number(order.amount),
    0
  );

  const totalPrepayment = orders.reduce(
    (sum, order) => sum + Number(order.prepayment),
    0
  );

  const totalDebt = orders.reduce(
    (sum, order) => sum + Number(order.balance),
    0
  );

  const contracts = orders.filter((order) =>
    [
      "Договор подписан",
      "Производство",
      "Монтаж",
      "Завершено",
    ].includes(order.status)
  ).length;

  const completed = productions.filter(
    (item) => item.stage === "Готово"
  ).length;

  const inProduction = productions.filter(
    (item) => item.stage !== "Готово"
  ).length;

  const monthlyGoal = 15;

  return {
    stats: {
      clients: clients.length,
      orders: orders.length,
      productions: productions.length,

      contracts,

      completed,

      inProduction,

      totalRevenue,

      totalPrepayment,

      totalDebt,

      monthlyGoal,

      progress:
        Math.round(
          (contracts / monthlyGoal) * 100
        ) > 100
          ? 100
          : Math.round(
              (contracts / monthlyGoal) * 100
            ),
    },

    latestClients: clients
      .sort(
        (a, b) =>
          b.createdAt.getTime() -
          a.createdAt.getTime()
      )
      .slice(0, 10),

    latestOrders: orders
      .sort(
        (a, b) =>
          b.createdAt.getTime() -
          a.createdAt.getTime()
      )
      .slice(0, 10),

    latestProductions: productions
      .sort(
        (a, b) =>
          b.createdAt.getTime() -
          a.createdAt.getTime()
      )
      .slice(0, 10),

    latestPayments: payments
      .sort(
        (a, b) =>
          b.createdAt.getTime() -
          a.createdAt.getTime()
      )
      .slice(0, 10),
  };
}