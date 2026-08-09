"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import OrderTable, { type OrderListItem } from "@/components/orders/OrderTable";
import {
  ORDER_STAGE_KEYS,
  ORDER_STAGE_LABELS,
  isOrderOverdue,
  orderDeadline,
  projectOrderStage,
  type OrderStageKey,
} from "@/lib/orders/presentation";

type Filter = "all" | OrderStageKey | "overdue";

export default function OrdersPage() {
  const { data: session } = useSession();
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [visibleCount, setVisibleCount] = useState(30);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/orders");
      const payload = await response.json() as OrderListItem[] | { error?: string };
      if (!response.ok || !Array.isArray(payload)) throw new Error(!Array.isArray(payload) ? payload.error : "Не удалось загрузить заказы");
      setOrders(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить заказы"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const counts = useMemo(() => {
    const result = Object.fromEntries(ORDER_STAGE_KEYS.map((key) => [key, 0])) as Record<OrderStageKey, number>;
    let overdue = 0;
    for (const order of orders) {
      result[projectOrderStage(order.lifecycle, order.productions[0]?.stage)] += 1;
      if (isOrderOverdue(orderDeadline(order), order.lifecycle)) overdue += 1;
    }
    return { ...result, all: orders.length, overdue };
  }, [orders]);

  const filtered = useMemo(() => orders.filter((order) => {
    const haystack = `${order.number} ${order.client.name} ${order.client.phone} ${order.client.city}`.toLowerCase();
    if (deferredQuery && !haystack.includes(deferredQuery)) return false;
    if (filter === "overdue") return isOrderOverdue(orderDeadline(order), order.lifecycle);
    return filter === "all" || projectOrderStage(order.lifecycle, order.productions[0]?.stage) === filter;
  }).sort((a, b) => {
    const aOverdue = isOrderOverdue(orderDeadline(a), a.lifecycle);
    const bOverdue = isOrderOverdue(orderDeadline(b), b.lifecycle);
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const ad = orderDeadline(a), bd = orderDeadline(b);
    return (ad ? new Date(ad).getTime() : Infinity) - (bd ? new Date(bd).getTime() : Infinity);
  }), [orders, deferredQuery, filter]);

  const tabs: Array<[Filter, string]> = [["all", "Все"], ...ORDER_STAGE_KEYS.map((key) => [key, ORDER_STAGE_LABELS[key]] as [Filter, string]), ["overdue", "Просрочены"]];
  return <section className="space-y-5 p-4 md:p-8">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><h1 className="text-3xl font-bold text-white">Заказы</h1><p className="mt-1 text-slate-400">Полученные заказы: от контрольного замера до установки</p></div><div className="flex flex-col gap-2 sm:flex-row">{["DIRECTOR", "MANAGER"].includes(session?.user.role ?? "") ? <Link href="/orders/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500"><Plus size={18} /> Новый заказ</Link> : null}<button onClick={() => void load()} disabled={loading} className="min-h-11 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-50">Обновить</button></div></header>
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
      {[["all", "Все"], ["measurement", "Контрольный замер"], ["preparation", "В работе"], ["ready", "Готовы к установке"], ["installation", "На установке"], ["overdue", "Просрочены"]].map(([key, label]) => <button key={key} onClick={() => setFilter(key as Filter)} className={`rounded-xl border p-3 text-left ${filter === key ? "border-blue-500 bg-blue-500/10" : "border-slate-800 bg-[#101827]"}`}><span className="block text-xs text-slate-400">{label}</span><strong className={key === "overdue" && counts.overdue ? "text-red-300" : "text-white"}>{counts[key as keyof typeof counts]}</strong></button>)}
    </div>
    <div className="rounded-2xl border border-slate-800 bg-[#101827] p-3">
      <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(30); }} placeholder="Номер заказа, клиент, телефон или город" className="min-h-11 w-full rounded-xl bg-slate-950 px-4 text-white outline-none sm:max-w-md" />
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">{tabs.map(([key, label]) => <button key={key} onClick={() => { setFilter(key); setVisibleCount(30); }} className={`whitespace-nowrap rounded-full px-4 py-2 text-sm ${filter === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}>{label} {counts[key]}</button>)}</div>
    </div>
    {error ? <p role="alert" className="text-red-300">{error}</p> : loading ? <p className="text-slate-400">Загрузка заказов…</p> : filtered.length ? <><OrderTable orders={filtered.slice(0, visibleCount)} />{visibleCount < filtered.length && <button onClick={() => setVisibleCount((value) => value + 30)} className="mx-auto block min-h-11 rounded-xl bg-slate-800 px-6 text-white">Показать ещё</button>}</> : <p className="rounded-2xl border border-slate-800 p-8 text-center text-slate-400">Заказы не найдены</p>}
  </section>;
}
