"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import OrderForm from "@/components/orders/OrderForm";
import OrderTable from "@/components/orders/OrderTable";

type Order = {
  id: number;
  number: string;
  status: string;
  client: { name: string; phone: string };
  material: string;
  staircase: string;
  amount: string;
  prepayment: string;
  balance: string;
  partnerPrice?: string;
  companyProfit?: string;
  partnerBalance?: string;
  manager: string;
};
const statuses = [
  "Все заказы",
  "Новая заявка",
  "Замер",
  "Передано партнеру",
  "Монтаж",
  "Завершено",
];
const statusLabel = (value: string) => value === "Передано партнеру" ? "Передано в цех" : value;

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Все заказы");

  const loadOrders = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/orders");
      const payload = (await response.json()) as Order[] | { error?: string };
      if (!response.ok || !Array.isArray(payload))
        throw new Error(
          !Array.isArray(payload)
            ? payload.error
            : "Не удалось загрузить заказы",
        );
      setOrders(payload);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить заказы",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadOrders(), 0);
    return () => window.clearTimeout(timer);
  }, [loadOrders]);
  const visibleOrders = useMemo(
    () =>
      orders.filter((order) => {
        const matchesQuery = `${order.number} ${order.client.name}`
          .toLowerCase()
          .includes(query.trim().toLowerCase());
        return (
          matchesQuery && (status === "Все заказы" || order.status === status)
        );
      }),
    [orders, query, status],
  );

  return (
    <section className="space-y-8 p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Заказы</h1>
          <p className="text-slate-400">Управление заказами ORDA ERP</p>
        </div>
        <button
          type="button"
          onClick={() => void loadOrders()}
          disabled={loading}
          className="rounded-xl bg-slate-800 px-5 py-3 text-white disabled:opacity-60"
        >
          {loading ? "Обновление..." : "Обновить"}
        </button>
      </div>
      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
        <div className="flex flex-wrap gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по номеру или клиенту"
            className="w-80 rounded-xl bg-slate-900 p-3 text-white outline-none"
          />
          {statuses.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStatus(item)}
              className={`rounded-xl px-5 py-3 text-white ${status === item ? "bg-blue-600" : "bg-slate-800"}`}
            >
            {statusLabel(item)}
            </button>
          ))}
        </div>
      </div>
      <OrderForm onSave={loadOrders} />
      {error ? (
        <p className="text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-slate-400">Загрузка заказов...</p>
      ) : visibleOrders.length === 0 ? (
        <p className="text-slate-400">Заказы не найдены.</p>
      ) : (
        <OrderTable orders={visibleOrders} />
      )}
    </section>
  );
}
