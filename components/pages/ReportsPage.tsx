"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import type { ComparableMetric, ReportsReadModel } from "@/lib/reports";

type Preset = "today" | "week" | "month" | "custom";
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;

export default function ReportsPage() {
  const [period, setPeriod] = useState<Preset>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managerOptions, setManagerOptions] = useState<Array<{ id: number; name: string }>>([]);
  const [report, setReport] = useState<ReportsReadModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const query = useMemo(() => {
    const params = new URLSearchParams({ period });
    if (period === "custom" && dateFrom && dateTo) { params.set("dateFrom", dateFrom); params.set("dateTo", dateTo); }
    if (managerId) params.set("managerId", managerId);
    return params;
  }, [dateFrom, dateTo, managerId, period]);
  const load = useCallback(async () => {
    if (period === "custom" && (!dateFrom || !dateTo)) return;
    setLoading(true); setError(""); setReport(null);
    try {
      const response = await fetch(`/api/reports?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const data = await response.json() as ReportsReadModel;
      setReport(data);
      if (!managerId) setManagerOptions(data.managers.map(({ id, name }) => ({ id, name })));
    } catch { setError("Не удалось загрузить отчёт. Проверьте соединение и повторите попытку."); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, managerId, period, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const empty = report && report.summary.leads.current === 0 && report.summary.orders.current === 0 && report.summary.received.current === 0;

  return <section className="min-w-0 space-y-5 p-4 sm:p-6 xl:p-8">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-[.2em] text-blue-400">Management reporting</p><h1 className="mt-1 text-3xl font-bold text-white">Отчёты</h1><p className="mt-1 text-sm text-slate-400">Управленческая сводка ALTYN SAPA COMPANY</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full overflow-x-auto rounded-xl border border-slate-700 bg-slate-900 p-1">{([['today','Сегодня'],['week','Неделя'],['month','Месяц'],['custom','Произвольный']] as const).map(([key,label]) => <button key={key} type="button" onClick={() => setPeriod(key)} className={`min-h-10 whitespace-nowrap rounded-lg px-3 text-sm font-medium ${period === key ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>{label}</button>)}</div>
        {report?.role !== "MANAGER" && <select aria-label="Менеджер" value={managerId} onChange={(event) => setManagerId(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-white"><option value="">Все менеджеры</option>{managerOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
        <a href={`/api/reports?${query}&export=csv`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500"><Download size={17}/>CSV</a>
      </div>
    </header>
    {period === "custom" && <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3"><label className="text-sm text-slate-400">С <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="ml-2 min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-2 text-white"/></label><label className="text-sm text-slate-400">По <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className="ml-2 min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-2 text-white"/></label></div>}
    {loading && <Loading />}
    {error && <div role="alert" className="rounded-2xl border border-red-800 bg-red-950/40 p-8 text-center text-red-100"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 font-semibold"><RefreshCw size={17}/>Повторить</button></div>}
    {!loading && !error && empty && <div className="rounded-2xl border border-slate-700 bg-slate-900 p-10 text-center text-slate-300">За выбранный период данных нет.</div>}
    {!loading && !error && report && !empty && <ReportContent report={report} />}
  </section>;
}

function ReportContent({ report }: { report: ReportsReadModel }) {
  const cards: Array<[string, ComparableMetric, (value:number)=>string]> = [["Заявки", report.summary.leads, String],["Замеры", report.summary.measurements, String],["Заказы", report.summary.orders, String],["Сумма продаж", report.summary.salesAmount, money],["Получено", report.summary.received, money]];
  const maxTrend = Math.max(1, ...report.trend.map((item) => Math.max(item.salesAmount, item.received)));
  return <>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{cards.map(([title,metric,format]) => <MetricCard key={title} title={title} metric={metric} format={format}/>)}</div>
    <div className="grid gap-5 xl:grid-cols-[.85fr_1.4fr]">
      <Panel title="Воронка"><div className="space-y-4">{report.funnel.map((item, index) => <div key={item.key} className="relative"><div className="flex items-end justify-between"><span className="text-sm text-slate-300">{index + 1}. {item.label}</span><strong className="text-2xl text-white">{item.value}</strong></div><div className="mt-2 h-2 rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{width:`${Math.max(5, (item.value / Math.max(1, report.funnel[0].value)) * 100)}%`}}/></div>{item.conversionFromPrevious !== null && <p className="mt-1 text-xs text-slate-500">{item.conversionFromPrevious}% с предыдущего этапа</p>}</div>)}</div></Panel>
      <Panel title="Динамика продаж и поступлений"><div className="flex h-52 min-w-0 items-end gap-2 overflow-hidden">{report.trend.length ? report.trend.map((item) => <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"><div className="flex h-40 items-end gap-1"><div title={`Продажи: ${money(item.salesAmount)}`} className="w-3 rounded-t bg-blue-500 sm:w-5" style={{height:`${Math.max(2,item.salesAmount/maxTrend*100)}%`}}/><div title={`Получено: ${money(item.received)}`} className="w-3 rounded-t bg-emerald-500 sm:w-5" style={{height:`${Math.max(2,item.received/maxTrend*100)}%`}}/></div><span className="max-w-full truncate text-[10px] text-slate-500">{item.date.slice(5)}</span></div>) : <p className="m-auto text-slate-500">Нет данных для графика</p>}</div><div className="mt-3 flex gap-4 text-xs text-slate-400"><span>● <i className="not-italic text-blue-400">Продажи</i></span><span>● <i className="not-italic text-emerald-400">Получено</i></span></div></Panel>
    </div>
    <Panel title="Продажи и платежи"><div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6"><Stat label="Заказов" value={report.sales.count}/><Stat label="Средний чек" value={money(report.sales.averageOrder)}/><Stat label="Завершено" value={report.sales.completed}/><Stat label="Получено" value={money(report.payments.received)}/><Stat label="Остаток" value={money(report.payments.remaining)}/>{report.sales.grossMargin !== undefined && <Stat label="Валовая маржа" value={money(report.sales.grossMargin)}/>}</div></Panel>
    {report.managers.length > 0 && <Panel title="Менеджеры"><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr>{["Менеджер","Заявки","Замеры","Заказы","Продажи","Получено","Конверсия"].map(x=><th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody>{report.managers.map(item=><tr key={item.id} className="border-t border-slate-800"><td className="px-3 py-3 font-semibold text-white">{item.name}</td><td className="px-3">{item.leads}</td><td className="px-3">{item.measurements}</td><td className="px-3">{item.orders}</td><td className="px-3">{money(item.salesAmount)}</td><td className="px-3">{money(item.received)}</td><td className="px-3">{item.conversion === null ? "—" : `${item.conversion}%`}</td></tr>)}</tbody></table></div><div className="grid gap-3 md:hidden">{report.managers.map(item=><div key={item.id} className="rounded-xl bg-slate-950 p-4"><strong>{item.name}</strong><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-400"><span>Заявки: {item.leads}</span><span>Замеры: {item.measurements}</span><span>Заказы: {item.orders}</span><span>Конверсия: {item.conversion === null ? "—" : `${item.conversion}%`}</span><span className="col-span-2 text-white">Продажи: {money(item.salesAmount)}</span></div></div>)}</div></Panel>}
    <Panel title="Последние заказы"><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr>{["№","Клиент","Менеджер","Сумма","Получено","Остаток","Статус"].map(x=><th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody>{report.orders.map(item=><tr key={item.id} className="border-t border-slate-800"><td className="px-3 py-3 font-semibold"><a className="text-blue-300 hover:text-blue-200" href={`/orders/${item.id}`}>{item.number}</a></td><td className="px-3">{item.client}</td><td className="px-3">{item.manager}</td><td className="px-3">{money(item.amount)}</td><td className="px-3">{money(item.received)}</td><td className="px-3">{money(item.remaining)}</td><td className="px-3">{item.status}</td></tr>)}</tbody></table></div><div className="grid gap-3 md:hidden">{report.orders.map(item=><a href={`/orders/${item.id}`} key={item.id} className="rounded-xl bg-slate-950 p-4"><div className="flex justify-between gap-3"><strong className="text-blue-300">{item.number}</strong><span className="text-xs text-slate-400">{item.status}</span></div><p className="mt-1 text-sm text-white">{item.client}</p><div className="mt-3 grid grid-cols-2 gap-1 text-xs text-slate-400"><span>Сумма {money(item.amount)}</span><span>Остаток {money(item.remaining)}</span></div></a>)}</div></Panel>
    {report.production.length > 0 && <Panel title="Производственная сводка"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{report.production.map(item=><Stat key={item.stage} label={item.stage} value={item.count}/>)}</div></Panel>}
  </>;
}
function MetricCard({title,metric,format}:{title:string;metric:ComparableMetric;format:(v:number)=>string}) { const up=(metric.changePercent??0)>=0; return <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4"><p className="truncate text-xs font-medium text-slate-400 sm:text-sm">{title}</p><p className="mt-2 truncate text-xl font-bold text-white sm:text-2xl">{format(metric.current)}</p><p className={`mt-2 flex items-center gap-1 text-xs ${metric.changePercent===null?"text-slate-500":up?"text-emerald-400":"text-rose-400"}`}>{metric.changePercent===null?"Нет базы сравнения":<>{up?<TrendingUp size={13}/>:<TrendingDown size={13}/>} {up?"+":""}{metric.changePercent}%</>}</p></div> }
function Panel({title,children}:{title:string;children:React.ReactNode}) { return <section className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white"><BarChart3 size={19} className="text-blue-400"/>{title}</h2>{children}</section> }
function Stat({label,value}:{label:string;value:string|number}) { return <div className="min-w-0 rounded-xl bg-slate-950 p-3"><p className="truncate text-xs text-slate-500">{label}</p><p className="mt-1 truncate font-semibold text-white">{value}</p></div> }
function Loading() { return <div aria-label="Загрузка отчёта" className="space-y-5 animate-pulse"><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({length:5},(_,i)=><div key={i} className="h-28 rounded-2xl bg-slate-800"/>)}</div><div className="grid gap-5 xl:grid-cols-2"><div className="h-72 rounded-2xl bg-slate-800"/><div className="h-72 rounded-2xl bg-slate-800"/></div></div> }
