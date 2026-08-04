import { prisma } from "@/lib/prisma";

export async function getProductions() {
  return prisma.production.findMany({
    include: {
      order: {
        include: {
          client: true,
          partner: true,
        },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

export async function getProduction(id: number) {
  return prisma.production.findUnique({
    where: {
      id,
    },
    include: {
      order: {
        include: {
          client: true,
          payments: true,
          measurements: true,
        },
      },
    },
  });
}

export async function updateProduction(
  id: number,
  data: {
    stage?: string;
    percent?: number;
    master?: string;
    masterUserId?: number | null;
    comment?: string;
    startDate?: Date | null;
    finishDate?: Date | null;
  }
) {
  return prisma.$transaction(async (tx) => {
    const currentProduction = await tx.production.findUnique({
      where: { id },
      include: { order: true },
    });

    if (!currentProduction) {
      return null;
    }

    const production = await tx.production.update({
      where: { id },
      data,
      include: {
        order: {
          include: {
            client: true,
            partner: true,
          },
        },
      },
    });

    const stageChanged =
      data.stage !== undefined && data.stage !== currentProduction.stage;

    if (stageChanged) {
      await tx.order.update({
        where: { id: currentProduction.orderId },
        data: { status: data.stage },
      });
    }

    const details = [
      `Этап: ${production.stage}`,
      `Готовность: ${production.percent}%`,
      production.master ? `Мастер: ${production.master}` : null,
      production.comment ? `Комментарий: ${production.comment}` : null,
    ]
      .filter(Boolean)
      .join(" • ");

    await tx.orderEvent.create({
      data: {
        orderId: currentProduction.orderId,
        title: stageChanged ? "Этап производства изменён" : "Производство обновлено",
        description: details,
        user: production.master || null,
      },
    });

    return production;
  });
}

export async function createProduction(data: {
  orderId: number;
  stage: string;
  percent: number;
    master: string;
    masterUserId?: number | null;
  comment?: string;
  startDate?: Date | null;
  finishDate?: Date | null;
}) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: data.orderId },
      select: { id: true },
    });

    if (!order) {
      return null;
    }

    const production = await tx.production.create({
      data,
      include: {
        order: {
          include: {
            client: true,
            partner: true,
          },
        },
      },
    });

    await tx.order.update({
      where: { id: data.orderId },
      data: { status: data.stage },
    });

    await tx.orderEvent.create({
      data: {
        orderId: data.orderId,
        title: "Производство создано",
        description: `Этап: ${data.stage} • Готовность: ${data.percent}%`,
        user: data.master || null,
      },
    });

    return production;
  });
}

export async function assignMaster(
  id: number,
  master: string
) {
  return prisma.production.update({
    where: {
      id,
    },
    data: {
      master,
    },
  });
}

export async function updateStage(
  id: number,
  stage: string,
  percent: number
) {
  return prisma.production.update({
    where: {
      id,
    },
    data: {
      stage,
      percent,
    },
  });
}

export async function getProductionStats() {
  const productions = await prisma.production.findMany();

  const waiting = productions.filter(
    (item) => item.stage === "Ожидание"
  ).length;

  const working = productions.filter(
    (item) => item.stage === "Производство"
  ).length;

  const painting = productions.filter(
    (item) => item.stage === "Покраска"
  ).length;

  const installation = productions.filter(
    (item) => item.stage === "Монтаж"
  ).length;

  const completed = productions.filter(
    (item) => item.stage === "Готово"
  ).length;

  const averagePercent =
    productions.length > 0
      ? Math.round(
          productions.reduce(
            (sum, item) => sum + item.percent,
            0
          ) / productions.length
        )
      : 0;

  return {
    total: productions.length,
    waiting,
    working,
    painting,
    installation,
    completed,
    averagePercent,
  };
}

export async function deleteProduction(id: number) {
  return prisma.production.delete({
    where: {
      id,
    },
  });
}
