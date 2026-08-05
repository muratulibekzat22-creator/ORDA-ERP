"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

import OrderTable from "@/components/orders/OrderTable";
import { ORDER_STATUSES } from "@/lib/orders/lifecycle";

const OrderForm = dynamic(() => import("@/components/orders/OrderForm"), { loading: () => <div role="status" className="h-48 animate-pulse rounded-2xl bg-slate-800">Загрузка формы…</div> });

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
const statuses = ["Все заказы", ...ORDER_STATUSES];
const statusLabel = (value: string) => value;

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Все заказы");
  const [showForm, setShowForm] = useState(false);
  const [visibleCount, setVisibleCount] = useState(30);
  const deferredQuery = useDeferredValue(query);

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
          .includes(deferredQuery.trim().toLowerCase());
        return (
          matchesQuery && (status === "Все заказы" || order.status === status)
        );
      }),
    [orders, deferredQuery, status],
  );
  const pagedOrders = visibleOrders.slice(0, visibleCount);

  return (
    <section className="space-y-8 p-4 md:p-8">
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
        <button type="button" onClick={() => setShowForm((value) => !value)} className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white">{showForm ? "Закрыть форму" : "Новый заказ"}</button>
      </div>
      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
        <div className="flex flex-wrap gap-3">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setVisibleCount(30); }}
            placeholder="Поиск по номеру или клиенту"
            className="w-80 rounded-xl bg-slate-900 p-3 text-white outline-none"
          />
          {statuses.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => { setStatus(item); setVisibleCount(30); }}
              className={`rounded-xl px-5 py-3 text-white ${status === item ? "bg-blue-600" : "bg-slate-800"}`}
            >
            {statusLabel(item)}
            </button>
          ))}
        </div>
      </div>
      {showForm && <OrderForm onSave={async () => { await loadOrders(); setShowForm(false); }} />}
      {error ? (
        <p className="text-red-400">{error}</p>
      ) : loading ? (
        <p className="text-slate-400">Загрузка заказов...</p>
      ) : visibleOrders.length === 0 ? (
        <p className="text-slate-400">Заказы не найдены.</p>
      ) : (
        <><OrderTable orders={pagedOrders} />{visibleCount < visibleOrders.length && <button type="button" onClick={() => setVisibleCount((value) => value + 30)} className="mx-auto block min-h-11 rounded-xl bg-slate-800 px-6 text-white">Показать ещё ({visibleOrders.length - visibleCount})</button>}</>
      )}
    </section>
  );
}
