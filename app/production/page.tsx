"use client";

import Link from "next/link";
import { Factory, MapPin, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ProductionOptions } from "@/components/production/ProductionEditor";
import type { ProductionKanbanItem } from "@/components/production/ProductionKanban";

const emptyOptions: ProductionOptions = { orders: [], assignees: [], partners: [] };

export default function ProductionPage() {
  const [productions, setProductions] = useState<ProductionKanbanItem[]>([]);
  const [options, setOptions] = useState<ProductionOptions>(emptyOptions);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [partnerId, setPartnerId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(async (targetPage = 1, append = false) => {
    const params = new URLSearchParams({ page: String(targetPage), limit: "50" });
    if (debouncedQuery) params.set("query", debouncedQuery);
    if (partnerId !== "") params.set("partnerId", String(partnerId));
    const response = await fetch(`/api/production?${params}`, { cache: "no-store" });
    const payload = await response.json() as { data?: ProductionKanbanItem[]; counters?: { total: number }; pagination?: { page: number; totalPages: number }; error?: string };
    if (!response.ok || !Array.isArray(payload.data)) throw new Error(payload.error ?? "Не удалось загрузить заказы производства");
    setProductions((current) => append ? [...current, ...payload.data!].filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index) : payload.data!);
    setTotal(payload.counters?.total ?? payload.data.length);
    setPage(payload.pagination?.page ?? targetPage);
    setTotalPages(payload.pagination?.totalPages ?? 1);
  }, [debouncedQuery, partnerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void fetch("/api/production?view=options", { cache: "no-store" })
      .then(async (response) => { if (response.ok) setOptions(await response.json() as ProductionOptions); })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void load(1, false).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось загрузить заказы")).finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <section role="status" aria-live="polite" className="space-y-4 p-4 md:p-8"><span className="sr-only">Загрузка производства</span><div className="h-20 animate-pulse rounded-2xl bg-slate-800"/><div className="h-72 animate-pulse rounded-2xl bg-slate-800"/></section>;

  return <main className="space-y-5 p-4 pb-24 md:p-8">
    <header><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-300">Производство</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Заказы по цехам</h1><p className="mt-1 text-sm text-slate-400">Без лишних внутренних стадий: заказ, клиент, материал и выбранный цех.</p></header>
    {options.partners.length ? <section className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4"><p className="text-sm font-semibold text-blue-200">Выберите цех</p><div className="mt-3 flex max-w-full gap-2 overflow-x-auto"><button type="button" onClick={() => setPartnerId("")} className={`min-h-11 shrink-0 rounded-xl px-4 font-semibold ${partnerId === "" ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}>Все цеха</button>{options.partners.map((partner) => <button key={partner.id} type="button" onClick={() => setPartnerId(partner.id)} className={`min-h-11 shrink-0 rounded-xl px-4 font-semibold ${partnerId === partner.id ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}>{partner.name}</button>)}</div></section> : null}
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-[#101827] p-3 sm:flex-row sm:items-center sm:justify-between"><label className="relative w-full max-w-xl"><Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={18}/><input aria-label="Поиск" placeholder="Заказ, клиент или адрес" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-white outline-none focus:border-blue-500"/></label><span className="text-sm text-slate-400">Найдено: <b className="text-white">{total}</b></span></div>
    {error ? <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
    {productions.length ? <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{productions.map((item) => <article key={item.id} className="rounded-2xl border border-slate-800 bg-[#101827] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold text-white">{item.order.number}</p><p className="truncate text-sm text-slate-300">{item.order.client.name}</p></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${item.order.partner ? "bg-cyan-500/10 text-cyan-300" : "bg-amber-500/10 text-amber-200"}`}><Factory size={13} className="mr-1 inline"/>{item.order.partner?.name ?? "Цех не выбран"}</span></div><p className="mt-3 flex gap-2 text-sm text-slate-400"><MapPin size={16} className="shrink-0"/>{item.order.address || "Адрес не указан"}</p><p className="mt-2 text-sm text-slate-400">Материал: <span className="text-slate-200">{item.order.material || "Не указан"}</span></p><Link href={`/orders/${item.order.id}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white hover:bg-slate-700">Открыть заказ</Link></article>)}</section> : <div className="rounded-2xl border border-dashed border-slate-700 py-16 text-center text-slate-400">У выбранного цеха заказов нет</div>}
    {page < totalPages ? <button type="button" onClick={() => void load(page + 1, true)} className="mx-auto block min-h-11 rounded-xl bg-slate-800 px-6 text-white">Показать ещё</button> : null}
  </main>;
}
