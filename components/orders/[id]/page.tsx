import { prisma } from "@/lib/prisma";

import ProjectHeader from "@/components/project/ProjectHeader";
import ProjectTabs from "@/components/project/ProjectTabs";
import ProjectInfo from "@/components/project/ProjectInfo";
import ProjectFinance from "@/components/project/ProjectFinance";
import ProjectMeasurement from "@/components/project/ProjectMeasurement";
import ProjectPayments from "@/components/project/ProjectPayments";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function OrderPage({ params }: Props) {
  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: {
      id: Number(id),
    },
    include: {
      client: true,
      measurements: true,
      payments: true,
    },
  });

  if (!order) {
    return (
      <div className="p-10 text-red-600 text-xl font-bold">
        Проект не найден
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">

      <ProjectHeader order={order} />

      <ProjectTabs />

      <ProjectInfo order={order} />

      <ProjectFinance order={order} />

      <ProjectMeasurement orderId={order.id} />

      <ProjectPayments orderId={order.id} />

    </div>
  );
}