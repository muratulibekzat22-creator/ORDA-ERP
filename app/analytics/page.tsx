"use client";

import { useEffect, useMemo, useState } from "react";

import SalesAnalytics from "@/components/analytics/SalesAnalytics";

export default function AnalyticsPage() {
  const [clients, setClients] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [production, setProduction] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
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
    setProduction(await productionRes.json());
  }

  const revenue = useMemo(() => {
    return orders.reduce(
      (sum, order) => sum + Number(order.amount),
      0
    );
  }, [orders]);

  const contracts = useMemo(() => {
    return orders.filter(
      (item) =>
        item.status === "Договор подписан" ||
        item.status === "Производство" ||
        item.status === "Монтаж" ||
        item.status === "Завершено"
    ).length;
  }, [orders]);

  const measurements = useMemo(() => {
    return orders.filter(
      (item) =>
        item.status === "Замер" ||
        item.status === "КП отправлено" ||
        item.status === "Договор подписан" ||
        item.status === "Производство" ||
        item.status === "Монтаж" ||
        item.status === "Завершено"
    ).length;
  }, [orders]);

  const proposals = useMemo(() => {
    return orders.filter(
      (item) =>
        item.status === "КП отправлено" ||
        item.status === "Договор подписан" ||
        item.status === "Производство" ||
        item.status === "Монтаж" ||
        item.status === "Завершено"
    ).length;
  }, [orders]);

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-4xl font-bold text-white">
          Аналитика директора
        </h1>

        <p className="text-slate-400">
          ORDA ERP • ALTYN SAPA COMPANY
        </p>

      </div>

      <SalesAnalytics
        totalLeads={clients.length}
        measurements={measurements}
        proposals={proposals}
        contracts={contracts}
      />

      <div className="grid grid-cols-4 gap-6">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            План месяца
          </p>

          <h2 className="mt-3 text-5xl font-bold text-blue-400">
            15
          </h2>

          <p className="mt-2 text-slate-500">
            договоров
          </p>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            Выполнено
          </p>

          <h2 className="mt-3 text-5xl font-bold text-green-400">
            {contracts}
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            Производство
          </p>

          <h2 className="mt-3 text-5xl font-bold text-yellow-400">
            {production.length}
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            Доход
          </p>

          <h2 className="mt-3 text-3xl font-bold text-green-400">
            {revenue.toLocaleString()} ₸
          </h2>

        </div>

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

        <h2 className="mb-6 text-2xl font-bold text-white">
          Выполнение плана
        </h2>

        <div className="h-5 rounded-full bg-slate-800">

          <div
            className="h-5 rounded-full bg-green-500 transition-all"
            style={{
              width: `${Math.min(
                (contracts / 15) * 100,
                100
              )}%`,
            }}
          />

        </div>

        <p className="mt-4 text-lg text-white">
          {contracts} из 15 договоров
        </p>

      </div>

    </section>
  );
}