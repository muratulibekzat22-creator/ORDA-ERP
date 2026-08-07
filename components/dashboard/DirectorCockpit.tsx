"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Period = "today" | "week" | "month";
type Summary = {
  metrics: { newLeads: number; activeLeads: number; overdueNextActions: number; proposalsSent: number; measurementsScheduled: number; orders: number; totalSales: number; receivedPrepayment: number; balanceToReceive: number; conversion: number };
  managers: Array<{ managerUserId: number; manager: string; newLeads: number; activeLeads: number; proposalsSent: number; measurementsScheduled: number; orders: number; conversion: number; overdueNextActions: number }>;
  activities: Array<{ id: string; title: string; subject: string; href: string; user: string | null; createdAt: string }>;
};

const periods: Record<Period, string> = { today: "Сегодня", week: "Неделя", month: "Месяц" };
const money = (value: number) => `${Math.round(value || 0).toLocaleString("ru-RU")} ₸`;

export default function DirectorCockpit() {
  const { data: session } = useSession();
  const isManager = session?.user.role === "MANAGER";
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/dashboard/sales?period=${period}`, { cache: "no-store" });
      const body = await response.json() as Summary & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить показатели");
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить показатели"); }
    finally { setLoading(false); }
  }, [period]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const metrics = data?.metrics;
  return <section className="space-y-6 overflow-x-hidden p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between"><div><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">{isManager ? "МОИ ПОКАЗАТЕЛИ" : "DIRECTOR DASHBOARD"}</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{isManager ? "Результаты менеджера" : "Показатели компании"}</h1><p className="mt-1 text-sm text-slate-400">Заявки считаются по Lead, продажи — только по оформленным Order.</p></div><div className="flex min-w-0 flex-col gap-2 sm:flex-row"><div className="grid min-w-0 grid-cols-3 rounded-xl border border-slate-700 bg-slate-900 p-1">{(Object.keys(periods) as Period[]).map((value) => <button type="button" key={value} aria-pressed={period === value} onClick={() => setPeriod(value)} className={`min-h-11 min-w-0 rounded-lg px-2 text-sm font-semibold sm:px-4 ${period === value ? "bg-blue-600 text-white" : "text-slate-300"}`}>{periods[value]}</button>)}</div><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/>Обновить</button></div></header>
    {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</p>}
    <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric label="Новые заявки" value={metrics?.newLeads ?? 0}/><Metric label="Активные заявки" value={metrics?.activeLeads ?? 0}/><Metric label="Просроченные действия" value={metrics?.overdueNextActions ?? 0} alert/><Metric label="Отправленные КП" value={metrics?.proposalsSent ?? 0}/><Metric label="Назначенные замеры" value={metrics?.measurementsScheduled ?? 0}/><Metric label="Оформленные заказы" value={metrics?.orders ?? 0}/><Metric label="Общая сумма продаж" value={money(metrics?.totalSales ?? 0)}/><Metric label="Полученная предоплата" value={money(metrics?.receivedPrepayment ?? 0)}/><Metric label="Остаток к получению" value={money(metrics?.balanceToReceive ?? 0)}/><Metric label="Конверсия в заказы" value={`${metrics?.conversion ?? 0}%`}/>
    </div>
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold text-white">Менеджеры</h2><Link href="/analytics" className="text-sm text-blue-300">Подробнее</Link></div>{data?.managers.length ? <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">{data.managers.map((manager) => <article key={manager.managerUserId} className="min-w-0 rounded-xl bg-slate-900 p-4"><h3 className="truncate font-bold text-white">{manager.manager}</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><Mini label="Новые" value={manager.newLeads}/><Mini label="Активные" value={manager.activeLeads}/><Mini label="КП" value={manager.proposalsSent}/><Mini label="Замеры" value={manager.measurementsScheduled}/><Mini label="Заказы" value={manager.orders}/><Mini label="Конверсия" value={`${manager.conversion}%`}/><Mini label="Просрочено" value={manager.overdueNextActions}/></dl></article>)}</div> : <Empty text="За выбранный период данных по менеджерам нет."/>}</section>
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5"><h2 className="mb-4 text-xl font-bold text-white">Последние важные действия</h2>{data?.activities.length ? <div className="divide-y divide-slate-800">{data.activities.map((item) => <Link key={item.id} href={item.href} className="flex min-w-0 flex-col gap-1 py-3 hover:text-blue-300 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0"><strong className="block truncate text-white">{item.subject}</strong><span className="block truncate text-sm text-slate-400">{item.title} · {item.user ?? "Система"}</span></span><time className="shrink-0 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("ru-RU")}</time></Link>)}</div> : <Empty text="Важных действий за выбранный период нет."/>}</section>
  </section>;
}

function Metric({ label, value, alert = false }: { label: string; value: number | string; alert?: boolean }) { return <article className="min-w-0 rounded-xl border border-slate-700 bg-[#101827] p-4"><p className="text-sm text-slate-400">{label}</p><p className={`mt-2 break-words text-2xl font-bold ${alert && Number(value) > 0 ? "text-red-300" : "text-white"}`}>{value}</p></article>; }
function Mini({ label, value }: { label: string; value: number | string }) { return <div><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-white">{value}</dd></div>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">{text}</p>; }
