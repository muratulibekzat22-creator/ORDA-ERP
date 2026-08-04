import { prisma } from "@/lib/prisma";

export async function getProductions() {
  return prisma.production.findMany({
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
    comment?: string;
    startDate?: Date;
    finishDate?: Date;
  }
) {
  return prisma.production.update({
    where: {
      id,
    },
    data,
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