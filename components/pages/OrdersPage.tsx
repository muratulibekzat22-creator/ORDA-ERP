"use client";

import { useEffect, useState } from "react";

import OrderForm from "@/components/orders/OrderForm";
import OrderTable from "@/components/orders/OrderTable";

export default function OrdersPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);

  async function loadOrders() {
    setLoading(true);

    try {
      const response = await fetch("/api/orders");

      if (!response.ok) return;

      const data = await response.json();

      setOrders(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
  }, []);

  return (
    <section className="space-y-8 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Заказы
          </h1>

          <p className="text-slate-400">
            Управление заказами ORDA ERP
          </p>

        </div>

        <button
          onClick={loadOrders}
          className="rounded-xl bg-slate-800 px-5 py-3 text-white hover:bg-slate-700"
        >
          {loading ? "Обновление..." : "Обновить"}
        </button>

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5">

        <div className="flex flex-wrap gap-3">

          <input
            disabled
            placeholder="Поиск (следующий этап)"
            className="w-80 rounded-xl bg-slate-900 p-3 text-slate-400 outline-none"
          />

          <button className="rounded-xl bg-blue-600 px-5 py-3 text-white">
            Все
          </button>

          <button className="rounded-xl bg-slate-800 px-5 py-3 text-white">
            Новые
          </button>

          <button className="rounded-xl bg-slate-800 px-5 py-3 text-white">
            Замер
          </button>

          <button className="rounded-xl bg-slate-800 px-5 py-3 text-white">
            Передано партнеру
          </button>

          <button className="rounded-xl bg-slate-800 px-5 py-3 text-white">
            Монтаж
          </button>

          <button className="rounded-xl bg-slate-800 px-5 py-3 text-white">
            Завершено
          </button>

        </div>

      </div>

      <OrderForm onSave={loadOrders} />

      <OrderTable orders={orders} />

    </section>
  );
}