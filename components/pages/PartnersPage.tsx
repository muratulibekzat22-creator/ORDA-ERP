"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface Partner {
  id: number;
  name: string;
  phone?: string | null;
  city?: string | null;
  email?: string | null;
  active: boolean;
  orders: {
    id: number;
    amount: string;
    partnerPaid: string;
    partnerBalance: string;
    companyProfit: string;
  }[];
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPartners();
  }, []);

  async function loadPartners() {
    try {
      const response = await fetch("/api/partners");

      if (!response.ok) {
        throw new Error("Ошибка загрузки партнеров");
      }

      const data = await response.json();

      setPartners(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <section className="flex-1 p-8">
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-white">
          Загрузка...
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-8 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Партнеры
          </h1>

          <p className="mt-2 text-slate-400">
            Управление производственными партнерами
          </p>

        </div>

        <button className="rounded-xl bg-yellow-500 px-5 py-3 font-semibold text-black hover:bg-yellow-400">
          + Новый партнер
        </button>

      </div>

      {partners.length === 0 ? (
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-slate-400">
          Пока нет партнеров
        </div>
      ) : (
        <div className="grid gap-6">

          {partners.map((partner) => {
            const totalOrders = partner.orders.length;

            const totalAmount = partner.orders.reduce(
              (sum, order) => sum + Number(order.amount),
              0
            );

            const paid = partner.orders.reduce(
              (sum, order) => sum + Number(order.partnerPaid),
              0
            );

            const balance = partner.orders.reduce(
              (sum, order) => sum + Number(order.partnerBalance),
              0
            );

            const profit = partner.orders.reduce(
              (sum, order) => sum + Number(order.companyProfit),
              0
            );

            return (
              <div
                key={partner.id}
                className="rounded-2xl border border-slate-700 bg-[#101827] p-6"
              >

                <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">

                  <div>

                    <div className="flex items-center gap-3">

                      <h2 className="text-2xl font-bold text-white">
                        {partner.name}
                      </h2>

                      <span
                        className={`rounded-lg px-3 py-1 text-sm ${
                          partner.active
                            ? "bg-green-600 text-white"
                            : "bg-red-600 text-white"
                        }`}
                      >
                        {partner.active ? "Активен" : "Неактивен"}
                      </span>

                    </div>

                    <p className="mt-3 text-slate-400">
                      📞 {partner.phone || "Телефон не указан"}
                    </p>

                    <p className="text-slate-400">
                      📍 {partner.city || "Город не указан"}
                    </p>

                    <p className="text-slate-400">
                      ✉️ {partner.email || "E-mail не указан"}
                    </p>

                  </div>

                  <div className="grid grid-cols-2 gap-6 xl:grid-cols-5">

                    <Stat
                      title="Заказы"
                      value={String(totalOrders)}
                      color="text-cyan-400"
                    />

                    <Stat
                      title="Сумма"
                      value={`${totalAmount.toLocaleString()} ₸`}
                      color="text-green-400"
                    />

                    <Stat
                      title="Выплачено"
                      value={`${paid.toLocaleString()} ₸`}
                      color="text-blue-400"
                    />

                    <Stat
                      title="Долг"
                      value={`${balance.toLocaleString()} ₸`}
                      color="text-yellow-400"
                    />

                    <Stat
                      title="Прибыль"
                      value={`${profit.toLocaleString()} ₸`}
                      color="text-purple-400"
                    />

                  </div>

                </div>

                <div className="mt-8 flex gap-4">

                  <Link
                    href={`/partners/${partner.id}`}
                    className="rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700"
                  >
                    Карточка
                  </Link>

                  <button className="rounded-xl bg-green-600 px-5 py-3 text-white hover:bg-green-700">
                    Новый заказ
                  </button>

                </div>

              </div>
            );
          })}

        </div>
      )}

    </section>
  );
}

function Stat({
  title,
  value,
  color,
}: {
  title: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-slate-900 p-4 text-center">

      <p className="text-sm text-slate-400">
        {title}
      </p>

      <p className={`mt-2 text-xl font-bold ${color}`}>
        {value}
      </p>

    </div>
  );
}