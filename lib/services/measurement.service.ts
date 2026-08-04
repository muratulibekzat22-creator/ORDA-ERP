import { prisma } from "@/lib/prisma";

export async function getMeasurements() {
  return prisma.measurement.findMany({
    include: {
      order: {
        include: {
          client: true,
        },
      },
    },
    orderBy: {
      visitDate: "desc",
    },
  });
}

export async function getMeasurement(id: number) {
  return prisma.measurement.findUnique({
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

export async function createMeasurement(data: {
  orderId: number;

  measurer: string;

  visitDate: Date;

  floorHeight?: number;
  staircaseWidth?: number;
  stepsCount?: number;

  comment?: string;
}) {
  return prisma.measurement.create({
    data,
  });
}

export async function updateMeasurement(
  id: number,
  data: {
    measurer?: string;
    visitDate?: Date;

    floorHeight?: number;
    staircaseWidth?: number;
    stepsCount?: number;

    comment?: string;
  }
) {
  return prisma.measurement.update({
    where: {
      id,
    },
    data,
  });
}

export async function deleteMeasurement(id: number) {
  return prisma.measurement.delete({
    where: {
      id,
    },
  });
}

export async function getMeasurementStats() {
  const measurements =
    await prisma.measurement.findMany();

  const total = measurements.length;

  const thisMonth = measurements.filter((item) => {
    const now = new Date();

    return (
      item.visitDate.getMonth() === now.getMonth() &&
      item.visitDate.getFullYear() === now.getFullYear()
    );
  }).length;

  return {
    total,
    thisMonth,
  };
}