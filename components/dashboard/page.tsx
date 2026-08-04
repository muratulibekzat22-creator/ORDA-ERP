"use client";

import { useEffect, useState } from "react";

import DashboardStats from "@/components/dashboard/DashboardStats";
import OrderTable from "@/components/orders/OrderTable";

export default function DashboardPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [productions, setProductions] = useState<any[]>([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  async function loadDashboard() {
    const [clientsRes, ordersRes, productionRes] =
      await Promise.all([
        fetch("/api/clients"),
        fetch("/api/orders"),
        fetch("/api/production"),
      ]);

    if (
      !clientsRes.ok ||
      !ordersRes.ok ||
      !productionRes.ok
    )
      return;

    setClients(await clientsRes.json());
    setOrders(await ordersRes.json());
    setProductions(await productionRes.json());
  }

  const totalRevenue = orders.reduce(
    (sum: number, order: any) =>
      sum + Number(order.amount),
    0
  );

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-4xl font-bold text-white">
          ORDA ERP
        </h1>

        <p className="text-slate-400">
          Главная панель управления ALTYN SAPA
        </p>

      </div>

      <DashboardStats
        totalClients={clients.length}
        totalOrders={orders.length}
        totalProduction={productions.length}
        totalRevenue={totalRevenue}
      />

      <div className="grid grid-cols-3 gap-6">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Последние клиенты
          </h2>

          <div className="space-y-4">

            {clients.slice(0, 5).map((client: any) => (

              <div
                key={client.id}
                className="rounded-xl bg-slate-900 p-4"
              >

                <h3 className="font-semibold text-white">
                  {client.name}
                </h3>

                <p className="text-slate-400">
                  {client.phone}
                </p>

              </div>

            ))}

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Производство
          </h2>

          <div className="space-y-4">

            {productions.slice(0, 5).map((item: any) => (

              <div
                key={item.id}
                className="rounded-xl bg-slate-900 p-4"
              >

                <h3 className="font-semibold text-white">
                  {item.order.number}
                </h3>

                <p className="text-slate-400">
                  {item.stage}
                </p>

                <p className="mt-2 font-bold text-yellow-400">
                  {item.percent}%
                </p>

              </div>

            ))}

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-6 text-xl font-bold text-white">
            Быстрые действия
          </h2>

          <div className="space-y-4">

            <button className="w-full rounded-xl bg-blue-600 py-3 text-white hover:bg-blue-700">
              Новый клиент
            </button>

            <button className="w-full rounded-xl bg-green-600 py-3 text-white hover:bg-green-700">
              Новый заказ
            </button>

            <button className="w-full rounded-xl bg-yellow-500 py-3 text-black hover:bg-yellow-400">
              Калькулятор
            </button>

            <button className="w-full rounded-xl bg-purple-600 py-3 text-white hover:bg-purple-700">
              Производство
            </button>

          </div>

        </div>

      </div>

      <OrderTable
        orders={orders.slice(0, 10)}
      />

    </section>
  );
}