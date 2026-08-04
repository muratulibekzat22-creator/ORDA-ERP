"use client";

import { useEffect, useMemo, useState } from "react";

import FinanceDashboard from "@/components/finance/FinanceDashboard";

export default function FinancePage() {
  const [orders, setOrders] = useState<any[]>([]);

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    const response = await fetch("/api/orders");

    if (!response.ok) return;

    const data = await response.json();

    setOrders(data);
  }

  const income = useMemo(() => {
    return orders.reduce(
      (sum, order) => sum + Number(order.amount),
      0
    );
  }, [orders]);

  const received = useMemo(() => {
    return orders.reduce(
      (sum, order) => sum + Number(order.prepayment),
      0
    );
  }, [orders]);

  const debt = useMemo(() => {
    return orders.reduce(
      (sum, order) => sum + Number(order.balance),
      0
    );
  }, [orders]);

  const partnerExpenses = useMemo(() => {
    return orders.reduce(
      (sum, order) => sum + Number(order.partnerPaid),
      0
    );
  }, [orders]);

  const companyProfit = useMemo(() => {
    return orders.reduce(
      (sum, order) => sum + Number(order.companyProfit),
      0
    );
  }, [orders]);

  const expenses = 4000000 + partnerExpenses;

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-3xl font-bold text-white">
          Финансы
        </h1>

        <p className="text-slate-400">
          Финансовая аналитика ALTYN SAPA
        </p>

      </div>

      <FinanceDashboard
        income={income}
        expenses={expenses}
        debt={debt}
      />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-4 text-xl font-bold text-white">
            Получено от клиентов
          </h2>

          <p className="text-4xl font-bold text-green-400">
            {received.toLocaleString()} ₸
          </p>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-4 text-xl font-bold text-white">
            Выплачено партнерам
          </h2>

          <p className="text-4xl font-bold text-red-400">
            {partnerExpenses.toLocaleString()} ₸
          </p>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-4 text-xl font-bold text-white">
            Прибыль компании
          </h2>

          <p className="text-4xl font-bold text-cyan-400">
            {companyProfit.toLocaleString()} ₸
          </p>

        </div>

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

        <h2 className="mb-6 text-2xl font-bold text-white">
          Финансы по заказам
        </h2>

        <table className="w-full">

          <thead>

            <tr className="border-b border-slate-700">

              <th className="py-3 text-left text-slate-400">
                Заказ
              </th>

              <th className="text-left text-slate-400">
                Клиент
              </th>

              <th className="text-left text-slate-400">
                Стоимость
              </th>

              <th className="text-left text-slate-400">
                Получено
              </th>

              <th className="text-left text-slate-400">
                Остаток
              </th>

              <th className="text-left text-slate-400">
                Прибыль
              </th>

            </tr>

          </thead>

          <tbody>

            {orders.map((order) => (

              <tr
                key={order.id}
                className="border-b border-slate-800 hover:bg-slate-900"
              >

                <td className="py-4 text-white">
                  {order.number}
                </td>

                <td className="text-white">
                  {order.client?.name}
                </td>

                <td className="font-semibold text-green-400">
                  {Number(order.amount).toLocaleString()} ₸
                </td>

                <td className="font-semibold text-blue-400">
                  {Number(order.prepayment).toLocaleString()} ₸
                </td>

                <td className="font-semibold text-yellow-400">
                  {Number(order.balance).toLocaleString()} ₸
                </td>

                <td className="font-semibold text-cyan-400">
                  {Number(order.companyProfit).toLocaleString()} ₸
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </section>
  );
}