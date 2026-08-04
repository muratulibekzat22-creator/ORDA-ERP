"use client";

import { useCallback, useEffect, useState } from "react";

import KanbanBoard from "@/components/crm/KanbanBoard";

type CrmOrder = { id: number; number: string; status: string; amount: string; client: { name: string; phone: string; city: string } };

export default function CRMPage() {
  const [orders, setOrders] = useState<CrmOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOrders = useCallback(async () => {
    try {
      const response = await fetch("/api/orders");

      if (!response.ok) {
        throw new Error("Ошибка загрузки");
      }

      const data = await response.json() as CrmOrder[];

      setOrders(data);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOrders(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);

  return (
    <section className="space-y-8 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-4xl font-bold text-white">
            CRM Воронка
          </h1>

          <p className="text-slate-400">
            Управление всеми заявками ALTYN SAPA
          </p>

        </div>

        <button
          className="rounded-xl bg-blue-600 px-6 py-3 text-white hover:bg-blue-700"
        >
          + Новая заявка
        </button>

      </div>

      <div className="grid grid-cols-5 gap-5">

        <div className="rounded-2xl bg-[#101827] border border-slate-700 p-5">
          <p className="text-slate-400">Всего заявок</p>
          <h2 className="mt-3 text-4xl font-bold text-blue-400">
            {orders.length}
          </h2>
        </div>

        <div className="rounded-2xl bg-[#101827] border border-slate-700 p-5">
          <p className="text-slate-400">Замеры</p>
          <h2 className="mt-3 text-4xl font-bold text-yellow-400">
            {
              orders.filter(
                (o) =>
                  o.status === "Назначен замер" ||
                  o.status === "Замер выполнен"
              ).length
            }
          </h2>
        </div>

        <div className="rounded-2xl bg-[#101827] border border-slate-700 p-5">
          <p className="text-slate-400">Договоры</p>
          <h2 className="mt-3 text-4xl font-bold text-green-400">
            {
              orders.filter(
                (o) => o.status === "Договор подписан"
              ).length
            }
          </h2>
        </div>

        <div className="rounded-2xl bg-[#101827] border border-slate-700 p-5">
          <p className="text-slate-400">Производство</p>
          <h2 className="mt-3 text-4xl font-bold text-purple-400">
            {
              orders.filter(
                (o) => o.status === "Производство"
              ).length
            }
          </h2>
        </div>

        <div className="rounded-2xl bg-[#101827] border border-slate-700 p-5">
          <p className="text-slate-400">Монтаж</p>
          <h2 className="mt-3 text-4xl font-bold text-orange-400">
            {
              orders.filter(
                (o) => o.status === "Монтаж"
              ).length
            }
          </h2>
        </div>

      </div>

      {loading ? (
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-slate-400">
          Загрузка...
        </div>
      ) : (
        <KanbanBoard orders={orders} />
      )}

    </section>
  );
}
