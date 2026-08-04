import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth=await requirePermission("reports");if(auth.response)return auth.response;
  try {
    const clients = await prisma.client.count();

    const orders = await prisma.order.findMany();

    const productions = await prisma.production.findMany();

    const revenue = orders.reduce(
      (sum, order) => sum + Number(order.amount),
      0
    );

    const received = orders.reduce(
      (sum, order) => sum + Number(order.prepayment),
      0
    );

    const debt = orders.reduce(
      (sum, order) => sum + Number(order.balance),
      0
    );

    const partnerPaid = orders.reduce(
      (sum, order) => sum + Number(order.partnerPaid),
      0
    );

    const companyProfit = orders.reduce(
      (sum, order) => sum + Number(order.companyProfit),
      0
    );

    const completedOrders = orders.filter(
      (order) => order.status === "Завершено"
    ).length;

    const productionCompleted = productions.filter(
      (item) => item.percent >= 100
    ).length;

    const productionInProgress = productions.filter(
      (item) => item.percent < 100
    ).length;

    const averageOrder =
      orders.length > 0
        ? Math.round(revenue / orders.length)
        : 0;

    const monthlyGoal = 15;

    const progress = Math.min(
      100,
      Math.round((completedOrders / monthlyGoal) * 100)
    );

    return NextResponse.json({
      generatedAt: new Date(),

      clients,

      orders: orders.length,

      completedOrders,

      monthlyGoal,

      progress,

      finance: {
        revenue,
        received,
        debt,
        partnerPaid,
        profit: companyProfit,
        averageOrder,
      },

      production: {
        total: productions.length,
        completed: productionCompleted,
        inProgress: productionInProgress,
      },

      kpi: {
        conversion:
          orders.length === 0
            ? 0
            : Math.round(
                (completedOrders / orders.length) * 100
              ),

        collectionRate:
          revenue === 0
            ? 0
            : Math.round((received / revenue) * 100),

        profitability:
          revenue === 0
            ? 0
            : Math.round((companyProfit / revenue) * 100),
      },
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        message: "Ошибка формирования отчета",
      },
      {
        status: 500,
      }
    );
  }
}
