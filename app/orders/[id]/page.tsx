import { notFound } from "next/navigation";

import OrderTabs from "@/components/orders/OrderTabs";
import { getOrder } from "@/lib/services/order.service";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function OrderDetailsPage({ params }: Props) {
  const { id } = await params;
  const order = await getOrder(Number(id));

  if (!order) {
    notFound();
  }

  return (
    <section className="space-y-8 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Заказ {order.number}</h1>
          <p className="mt-1 text-slate-400">Карточка заказа ORDA ERP</p>
        </div>

        <div className="rounded-xl bg-slate-900 px-5 py-3">
          <span className="text-sm text-slate-400">Текущий статус</span>
          <p className="font-bold text-green-400">{order.status}</p>
        </div>
      </div>

      <OrderTabs order={order} />
    </section>
  );
}
