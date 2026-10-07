"use client";

import Link from "next/link";
import { CalendarDays, Clock3, Factory, Gauge, MapPin, Search, UserRound } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { ProductionOptions } from "@/components/production/ProductionEditor";
import type { ProductionKanbanItem } from "@/components/production/ProductionKanban";
import { isProductionOverdue } from "@/lib/production/kanban";

const emptyOptions: ProductionOptions = { orders: [], assignees: [], partners: [] };
const date = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Не указан";

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
  const [counters, setCounters] = useState<{ total: number; overdue: number; byStage: Record<string, number> }>({ total: 0, overdue: 0, byStage: {} });

  const load = useCallback(async (targetPage = 1, append = false) => {
    const params = new URLSearchParams({ page: String(targetPage), limit: "50" });
    if (debouncedQuery) params.set("query", debouncedQuery);
    if (partnerId !== "") params.set("partnerId", String(partnerId));
    const response = await fetch(`/api/production?${params}`, { cache: "no-store" });
    const payload = await response.json() as { data?: ProductionKanbanItem[]; counters?: { total: number; overdue: number; byStage: Record<string, number> }; pagination?: { page: number; totalPages: number }; error?: string };
    if (!response.ok || !Array.isArray(payload.data)) throw new Error(payload.error ?? "Не удалось загрузить заказы производства");
    setProductions((current) => append ? [...current, ...payload.data!].filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index) : payload.data!);
    setTotal(payload.counters?.total ?? payload.data.length);
    setCounters(payload.counters ?? { total: payload.data.length, overdue: 0, byStage: {} });
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
    <header><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-300">Производство</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Заказы по цехам</h1><p className="mt-1 text-sm text-slate-400">Текущий этап, готовность, ответственный мастер и плановый срок по каждому заказу.</p></header>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Summary label="В работе" value={counters.total}/><Summary label="Просрочено" value={counters.overdue} alert={counters.overdue > 0}/>{Object.entries(counters.byStage).filter(([, count]) => count > 0).slice(0, 2).map(([stage, count]) => <Summary key={stage} label={stage} value={count}/>)}</section>
    {options.partners.length ? <section className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-4"><p className="text-sm font-semibold text-blue-200">Выберите цех</p><div className="mt-3 flex max-w-full gap-2 overflow-x-auto"><button type="button" onClick={() => setPartnerId("")} className={`min-h-11 shrink-0 rounded-xl px-4 font-semibold ${partnerId === "" ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}>Все цеха</button>{options.partners.map((partner) => <button key={partner.id} type="button" onClick={() => setPartnerId(partner.id)} className={`min-h-11 shrink-0 rounded-xl px-4 font-semibold ${partnerId === partner.id ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}>{partner.name}</button>)}</div></section> : null}
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-[#101827] p-3 sm:flex-row sm:items-center sm:justify-between"><label className="relative w-full max-w-xl"><Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={18}/><input aria-label="Поиск" placeholder="Заказ, клиент или адрес" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-white outline-none focus:border-blue-500"/></label><span className="text-sm text-slate-400">Найдено: <b className="text-white">{total}</b></span></div>
    {error ? <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}
    {productions.length ? <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{productions.map((item) => { const overdue = isProductionOverdue(item); return <article key={item.id} className={`rounded-2xl border bg-[#101827] p-4 ${overdue ? "border-red-500/50" : "border-slate-800"}`}><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-bold text-white">{item.order.number}</p><p className="truncate text-sm text-slate-300">{item.order.client.name}</p></div><span className="shrink-0 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-200">{item.stage}</span></div><div className="mt-3"><div className="flex items-center justify-between text-xs text-slate-400"><span className="flex items-center gap-1"><Gauge size={14}/>Готовность</span><b className="text-white">{item.percent}%</b></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }}/></div></div><p className={`mt-3 flex items-center gap-2 text-sm font-semibold ${item.order.partner ? "text-cyan-300" : "text-amber-200"}`}><Factory size={16}/>{item.order.partner?.name ?? "Цех не выбран"}</p><p className="mt-2 flex gap-2 text-sm text-slate-400"><MapPin size={16} className="shrink-0"/>{item.order.address || "Адрес не указан"}</p><p className="mt-2 flex items-center gap-2 text-sm text-slate-400"><UserRound size={16}/>{item.master || "Мастер не назначен"}</p><p className={`mt-2 flex items-center gap-2 text-sm ${overdue ? "font-semibold text-red-300" : "text-slate-400"}`}>{overdue ? <Clock3 size={16}/> : <CalendarDays size={16}/>}Срок: {date(item.plannedEndAt)}{overdue ? " · просрочено" : ""}</p><p className="mt-2 text-sm text-slate-400">Материал: <span className="text-slate-200">{item.order.material || "Не указан"}</span></p>{item.comment ? <p className="mt-3 rounded-lg bg-slate-950 p-2 text-xs text-slate-300">{item.comment}</p> : null}<Link href={`/orders/${item.order.id}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-800 px-4 text-sm font-semibold text-white hover:bg-slate-700">Открыть заказ</Link></article>; })}</section> : <div className="rounded-2xl border border-dashed border-slate-700 py-16 text-center text-slate-400">У выбранного цеха заказов нет</div>}
    {page < totalPages ? <button type="button" onClick={() => void load(page + 1, true)} className="mx-auto block min-h-11 rounded-xl bg-slate-800 px-6 text-white">Показать ещё</button> : null}
  </main>;
}

function Summary({ label, value, alert = false }: { label: string; value: number; alert?: boolean }) {
  return <div className={`rounded-2xl border p-4 ${alert ? "border-red-500/30 bg-red-500/5" : "border-slate-800 bg-[#101827]"}`}><p className="truncate text-xs text-slate-400">{label}</p><p className={`mt-1 text-2xl font-bold ${alert ? "text-red-200" : "text-white"}`}>{value}</p></div>;
}
