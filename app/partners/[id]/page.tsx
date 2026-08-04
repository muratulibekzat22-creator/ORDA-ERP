import { notFound } from "next/navigation";
import { getPartner } from "@/lib/services/partner.service";

interface Props {
  params: Promise<{
    id: string;
  }>;
}

export default async function PartnerPage({
  params,
}: Props) {
  const { id } = await params;

  const partner = await getPartner(Number(id));

  if (!partner) {
    notFound();
  }

  return (
    <main className="space-y-8 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            {partner.name}
          </h1>

          <p className="mt-2 text-slate-400">
            Карточка партнера
          </p>

        </div>

        <span
          className={`rounded-xl px-4 py-2 ${
            partner.active
              ? "bg-green-600 text-white"
              : "bg-red-600 text-white"
          }`}
        >
          {partner.active ? "Активен" : "Неактивен"}
        </span>

      </div>

      <div className="grid gap-6 xl:grid-cols-4">

        <Card
          title="Заказы"
          value={partner.stats.totalOrders}
          color="text-cyan-400"
        />

        <Card
          title="Сумма заказов"
          value={`${partner.stats.totalAmount.toLocaleString()} ₸`}
          color="text-green-400"
        />

        <Card
          title="Выплачено"
          value={`${partner.stats.partnerPaid.toLocaleString()} ₸`}
          color="text-blue-400"
        />

        <Card
          title="Осталось"
          value={`${partner.stats.partnerBalance.toLocaleString()} ₸`}
          color="text-yellow-400"
        />

      </div>

      <div className="grid gap-6 xl:grid-cols-2">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Информация
          </h2>

          <div className="space-y-4">

            <Info
              title="Телефон"
              value={partner.phone || "—"}
            />

            <Info
              title="E-mail"
              value={partner.email || "—"}
            />

            <Info
              title="Город"
              value={partner.city || "—"}
            />

            <Info
              title="Прибыль ALTYN SAPA"
              value={`${partner.stats.companyProfit.toLocaleString()} ₸`}
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Заказы
          </h2>

          <div className="space-y-4">

            {partner.orders.length === 0 ? (
              <p className="text-slate-400">
                Заказов пока нет
              </p>
            ) : (
              partner.orders.map((order) => (
                <div
                  key={order.id}
                  className="rounded-xl bg-slate-900 p-4"
                >

                  <div className="flex justify-between">

                    <div>

                      <p className="font-semibold text-white">
                        {order.number}
                      </p>

                      <p className="text-sm text-slate-400">
                        {order.client.name}
                      </p>

                    </div>

                    <span className="text-green-400 font-bold">
                      {Number(order.amount).toLocaleString()} ₸
                    </span>

                  </div>

                </div>
              ))
            )}

          </div>

        </div>

      </div>

    </main>
  );
}

function Card({
  title,
  value,
  color,
}: {
  title: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <p className="text-slate-400">
        {title}
      </p>

      <h2 className={`mt-3 text-3xl font-bold ${color}`}>
        {value}
      </h2>

    </div>
  );
}

function Info({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="flex justify-between border-b border-slate-700 pb-3">

      <span className="text-slate-400">
        {title}
      </span>

      <span className="font-medium text-white">
        {value}
      </span>

    </div>
  );
}