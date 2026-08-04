import { notFound } from "next/navigation";

import { getOrder } from "@/lib/services/order.service";
import OrderCard from "@/components/orders/OrderCard";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function OrderDetailsPage({
  params,
}: Props) {
  const { id } = await params;

  const order = await getOrder(Number(id));

  if (!order) {
    notFound();
  }

  return (
    <section className="space-y-8 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">
            Заказ {order.number}
          </h1>

          <p className="text-slate-400">
            Полная карточка заказа ORDA ERP
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 px-5 py-3">
          <span className="text-slate-400">
            Статус
          </span>

          <p className="font-bold text-green-400">
            {order.status}
          </p>
        </div>
      </div>

      <OrderCard order={order} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
          <h2 className="mb-6 text-xl font-bold text-white">
            💰 Финансы
          </h2>

          <div className="space-y-5">

            <div className="flex justify-between">
              <span className="text-slate-400">
                Стоимость клиенту
              </span>

              <span className="font-bold text-green-400">
                {Number(order.amount).toLocaleString()} ₸
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">
                Предоплата
              </span>

              <span className="font-bold text-blue-400">
                {Number(order.prepayment).toLocaleString()} ₸
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">
                Остаток клиента
              </span>

              <span className="font-bold text-orange-400">
                {Number(order.balance).toLocaleString()} ₸
              </span>
            </div>

            <hr className="border-slate-700" />

            <div className="flex justify-between">
              <span className="text-slate-400">
                Стоимость партнера
              </span>

              <span className="font-bold text-cyan-400">
                {Number(order.partnerPrice).toLocaleString()} ₸
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">
                Выплачено партнеру
              </span>

              <span className="font-bold text-sky-400">
                {Number(order.partnerPaid).toLocaleString()} ₸
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-slate-400">
                Осталось партнеру
              </span>

              <span className="font-bold text-yellow-400">
                {Number(order.partnerBalance).toLocaleString()} ₸
              </span>
            </div>

            <hr className="border-slate-700" />

            <div className="flex justify-between text-lg">
              <span className="font-semibold text-white">
                Прибыль
              </span>

              <span className="font-bold text-green-500">
                {Number(order.companyProfit).toLocaleString()} ₸
              </span>
            </div>

          </div>
        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
          <h2 className="mb-4 text-xl font-bold text-white">
            📏 Замеры
          </h2>

          {order.measurements.length === 0 ? (
            <p className="text-slate-400">
              Пока нет данных
            </p>
          ) : (
            order.measurements.map((item) => (
              <div
                key={item.id}
                className="mb-4 border-b border-slate-700 pb-4"
              >
                <p className="font-semibold text-white">
                  {item.measurer}
                </p>

                <p className="text-slate-400">
                  {new Date(item.visitDate).toLocaleDateString("ru-RU")}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
          <h2 className="mb-4 text-xl font-bold text-white">
            🏗 Передано партнеру
          </h2>

          {order.productions.length === 0 ? (
            <p className="text-slate-400">
              Пока нет данных
            </p>
          ) : (
            order.productions.map((production) => (
              <div
                key={production.id}
                className="mb-4 border-b border-slate-700 pb-4"
              >
                <p className="font-semibold text-white">
                  {production.stage}
                </p>

                <p className="font-bold text-yellow-400">
                  {production.percent}%
                </p>

                <p className="text-sm text-slate-500">
                  {production.master}
                </p>
              </div>
            ))
          )}
        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
          <h2 className="mb-4 text-xl font-bold text-white">
            📜 История
          </h2>

          {order.events.length === 0 ? (
            <p className="text-slate-400">
              Пока нет событий
            </p>
          ) : (
            order.events.map((event) => (
              <div
                key={event.id}
                className="mb-4 border-b border-slate-700 pb-4"
              >
                <p className="font-semibold text-white">
                  {event.title}
                </p>

                {event.description && (
                  <p className="mt-1 text-sm text-slate-400">
                    {event.description}
                  </p>
                )}

                {event.user && (
                  <p className="mt-2 text-xs text-slate-500">
                    {event.user}
                  </p>
                )}

                <p className="mt-1 text-xs text-slate-500">
                  {new Date(event.createdAt).toLocaleString("ru-RU")}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}