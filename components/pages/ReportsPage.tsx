"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Download, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import type { ComparableMetric, ReportsReadModel } from "@/lib/reports";

type Preset = "today" | "week" | "month" | "quarter" | "year" | "custom";
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;

export default function ReportsPage() {
  const [period, setPeriod] = useState<Preset>("month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [managerId, setManagerId] = useState("");
  const [managerStatus, setManagerStatus] = useState<"ALL" | "ACTIVE" | "TERMINATED">("ALL");
  const [managerOptions, setManagerOptions] = useState<Array<{ id: number; name: string; active: boolean }>>([]);
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
      if (!managerId) setManagerOptions(data.managers.map(({ id, name, active }) => ({ id, name, active })));
    } catch { setError("Не удалось загрузить отчёт. Проверьте соединение и повторите попытку."); }
    finally { setLoading(false); }
  }, [dateFrom, dateTo, managerId, period, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const empty = report && report.summary.leads.current === 0 && report.summary.orders.current === 0 && report.summary.received.current === 0 && (!report.finance || Object.values(report.finance).every((value) => value === 0));
  const visibleManagers = report?.managers.filter((item) => managerStatus === "ALL" || (managerStatus === "ACTIVE" ? item.active : !item.active)) ?? [];
  const visibleManagerOptions = managerOptions.filter((item) => managerStatus === "ALL" || (managerStatus === "ACTIVE" ? item.active : !item.active));

  return <section className="min-w-0 space-y-5 p-4 sm:p-6 xl:p-8">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-[.2em] text-blue-400">Management reporting</p><h1 className="mt-1 text-3xl font-bold text-white">Отчёты</h1><p className="mt-1 text-sm text-slate-400">Управленческая сводка ALTYN SAPA COMPANY</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex max-w-full overflow-x-auto rounded-xl border border-slate-700 bg-slate-900 p-1">{([['today','Сегодня'],['week','Неделя'],['month','Месяц'],['quarter','Квартал'],['year','Год'],['custom','Произвольный']] as const).map(([key,label]) => <button key={key} type="button" onClick={() => setPeriod(key)} className={`min-h-10 whitespace-nowrap rounded-lg px-3 text-sm font-medium ${period === key ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>{label}</button>)}</div>
        {report?.role !== "MANAGER" && <><select aria-label="Статус менеджера" value={managerStatus} onChange={(event) => { setManagerStatus(event.target.value as "ALL" | "ACTIVE" | "TERMINATED"); setManagerId(""); }} className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-white"><option value="ALL">Все сотрудники</option><option value="ACTIVE">Действующие</option><option value="TERMINATED">Бывшие</option></select><select aria-label="Менеджер" value={managerId} onChange={(event) => setManagerId(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-white"><option value="">Все менеджеры</option>{visibleManagerOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></>}
        <a href={`/api/reports?${query}&export=csv`} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500"><Download size={17}/>CSV</a>
      </div>
    </header>
    {period === "custom" && <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/70 p-3"><label className="text-sm text-slate-400">С <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="ml-2 min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-2 text-white"/></label><label className="text-sm text-slate-400">По <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className="ml-2 min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-2 text-white"/></label></div>}
    {loading && <Loading />}
    {error && <div role="alert" className="rounded-2xl border border-red-800 bg-red-950/40 p-8 text-center text-red-100"><p>{error}</p><button type="button" onClick={() => void load()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-red-700 px-4 font-semibold"><RefreshCw size={17}/>Повторить</button></div>}
    {!loading && !error && empty && <div className="rounded-2xl border border-slate-700 bg-slate-900 p-10 text-center text-slate-300">За выбранный период данных нет.</div>}
    {!loading && !error && report && !empty && <ReportContent report={{ ...report, managers: visibleManagers }} />}
    {!loading && !error && report && <EmployeeKpiReport month={report.period.dateFrom.slice(0, 7)} monthly={report.period.preset === "month"} managerId={managerId} statusFilter={managerStatus} />}
  </section>;
}

type EmployeeKpiSummary = {
  rows: Array<{
    employeeId: number;
    userId: number | null;
    name: string;
    position: string;
    active: boolean;
    metrics: Array<{ code: string; title: string; unit: "COUNT" | "MONEY" | "PERCENT"; actual: number | null; target: number | null; completionPercent: number | null }>;
  }>;
};

function EmployeeKpiReport({ month, monthly, managerId, statusFilter }: { month: string; monthly: boolean; managerId: string; statusFilter: "ALL" | "ACTIVE" | "TERMINATED" }) {
  const [data, setData] = useState<EmployeeKpiSummary | null>(null);
  const [loadedMonth, setLoadedMonth] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!monthly) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/kpi?month=${encodeURIComponent(month)}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json() as EmployeeKpiSummary & { error?: string };
        if (!response.ok) throw new Error(body.error || "Не удалось загрузить KPI сотрудников");
        setData(body); setLoadedMonth(month); setError("");
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Не удалось загрузить KPI сотрудников");
      }
    }, 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [month, monthly]);
  if (!monthly) return <Panel title="KPI сотрудников"><p className="text-sm text-slate-400">KPI назначаются помесячно. Выберите период «Месяц» или откройте полный отчёт с фильтрами по сотруднику, роли и должности.</p><a href={`/kpi?month=${month}`} className="mt-3 inline-block font-semibold text-blue-300">Открыть KPI сотрудников</a></Panel>;
  const currentData = loadedMonth === month ? data : null;
  const rows = currentData?.rows.filter((row) => (!managerId || String(row.userId) === managerId) && (statusFilter === "ALL" || (statusFilter === "ACTIVE" ? row.active : !row.active))) ?? [];
  return <Panel title={`KPI всех сотрудников · ${month}`}>
    <div className="mb-3 flex flex-wrap justify-between gap-2 text-sm"><p className="text-slate-400">План назначает директор. Факты автоматических показателей берутся из рабочих разделов.</p><div className="flex gap-3"><a href={`/kpi?month=${month}`} className="font-semibold text-blue-300">Фильтры и редактирование KPI</a><a href={`/api/kpi?month=${month}&export=csv`} className="font-semibold text-emerald-300">CSV сотрудников</a></div></div>
    {error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    {!currentData && !error && <p className="text-sm text-slate-500">Загружаем сотрудников…</p>}
    {currentData && !rows.length && <p className="rounded-lg border border-dashed border-slate-700 p-5 text-sm text-slate-400">Сотрудников по выбранному фильтру нет.</p>}
    {rows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-sm"><thead className="border-b border-slate-700 text-left text-slate-400"><tr>{["Сотрудник", "Должность", "Показатель", "План", "Факт", "Выполнение"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{rows.flatMap((row) => row.metrics.map((metric) => <tr key={`${row.employeeId}:${metric.code}`}><td className="px-3 py-2 font-semibold text-white">{row.name}{!row.active && <span className="ml-2 text-xs font-normal text-amber-300">Бывший</span>}</td><td className="px-3 py-2 text-slate-400">{row.position}</td><td className="px-3 py-2">{metric.title}</td><td className="px-3 py-2 tabular-nums">{metric.target === null ? "Не задан" : metric.unit === "MONEY" ? money(metric.target) : metric.target.toLocaleString("ru-RU")}</td><td className="px-3 py-2 tabular-nums">{metric.actual === null ? "—" : metric.unit === "MONEY" ? money(metric.actual) : metric.actual.toLocaleString("ru-RU")}</td><td className="px-3 py-2 font-semibold tabular-nums text-blue-200">{metric.completionPercent === null ? "—" : `${metric.completionPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}</td></tr>))}</tbody></table></div>}
  </Panel>;
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
    <Panel title="Продажи и платежи"><div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-7"><Stat label="Заказов" value={report.sales.count}/><Stat label="Без цены производства" value={report.dataQuality.missingProductionPrice}/><Stat label="Средний чек" value={money(report.sales.averageOrder)}/><Stat label="Завершено" value={report.sales.completed}/><Stat label="Получено" value={money(report.payments.received)}/><Stat label="Остаток" value={money(report.payments.remaining)}/>{report.sales.grossMargin !== undefined && <Stat label={`Валовая маржа (${report.sales.ordersWithMargin ?? 0} заказов)`} value={money(report.sales.grossMargin)}/>}</div></Panel>
    {report.finance && <Panel title="Финансовая сводка"><p className="mb-4 text-sm text-slate-400">Маржа считается по {report.finance.ordersWithMargin} заказам с обеими суммами. Ещё {report.finance.ordersWithoutMargin} заказов без цены производства. При неполных данных чистая прибыль не показывается.</p><div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"><Stat label="Продажи" value={money(report.finance.sales)}/><Stat label="Получено от клиентов" value={money(report.finance.customerReceived)}/><Stat label="К получению" value={money(report.finance.customerRemaining)}/><Stat label="Цена производства" value={money(report.finance.productionCost)}/><Stat label="Валовая маржа" value={money(report.finance.grossMargin)}/><Stat label="Валовая маржа, %" value={report.finance.grossMarginRate === null ? "—" : `${report.finance.grossMarginRate}%`}/><Stat label="Прочие доходы" value={money(report.finance.additionalIncome)}/><Stat label="Операционные расходы" value={money(report.finance.operatingExpenses)}/>{report.finance.netProfit !== null && <Stat label="Чистая прибыль" value={money(report.finance.netProfit)}/>}<Stat label="Согласовано партнёрам" value={money(report.finance.partnerAgreed)}/><Stat label="Выплачено партнёрам" value={money(report.finance.partnerPaid)}/><Stat label="К выплате партнёрам" value={money(report.finance.partnerRemaining)}/>{report.finance.payrollAccrued !== null && <Stat label="Зарплата начислена" value={money(report.finance.payrollAccrued)}/>} {report.finance.payrollPaid !== null && <Stat label="Зарплата выплачена" value={money(report.finance.payrollPaid)}/>} {report.finance.payrollPayable !== null && <Stat label="Зарплата к выплате по проведённым начислениям" value={money(report.finance.payrollPayable)}/>}</div>{report.finance.expensesByCategory.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{report.finance.expensesByCategory.map(item=><div key={item.category} className="flex justify-between rounded-xl bg-slate-950 p-3 text-sm"><span className="text-slate-400">{item.category}</span><strong>{money(item.amount)}</strong></div>)}</div>}</Panel>}
    {report.dataQuality.tasks.length > 0 && <Panel title="Что нужно дополнить"><p className="mb-3 text-sm text-slate-400">Список сформирован автоматически по заказам выбранного месяца. Директор видит общий контроль, менеджер получает свои пункты на главной.{report.dataQuality.tasks.length < report.dataQuality.incompleteOrders ? ` Показано ${report.dataQuality.tasks.length} из ${report.dataQuality.incompleteOrders}; полный список доступен в CSV.` : ""}</p><div className="space-y-2">{report.dataQuality.tasks.map(item=><a key={item.orderId} href={`/orders/${item.orderId}`} className="block rounded-xl border border-amber-500/20 bg-amber-500/5 p-3"><div className="flex flex-wrap justify-between gap-2"><strong className="text-white">{item.number} · {item.client}</strong><span className="text-sm text-slate-400">{item.manager}</span></div><p className="mt-2 text-sm text-amber-200">{item.missingFields.join(" · ")}</p></a>)}</div></Panel>}
    {report.managers.length > 0 && <Panel title="KPI менеджеров"><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr>{["Менеджер","Заявки","Замеры","Заказы","Завершено","Просрочено","Продажи","Получено","Заказы / заявки периода"].map(x=><th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody>{report.managers.map(item=><tr key={item.id} className="border-t border-slate-800"><td className="px-3 py-3 font-semibold text-white">{item.name}</td><td className="px-3">{item.leads}</td><td className="px-3">{item.measurements}</td><td className="px-3">{item.orders}</td><td className="px-3">{item.completed}</td><td className="px-3 text-amber-300">{item.overdue}</td><td className="px-3">{money(item.salesAmount)}</td><td className="px-3">{money(item.received)}</td><td className="px-3">{item.conversion === null ? "—" : `${item.conversion}%`}</td></tr>)}</tbody></table></div><div className="grid gap-3 md:hidden">{report.managers.map(item=><div key={item.id} className="rounded-xl bg-slate-950 p-4"><strong>{item.name}</strong><div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-400"><span>Заявки: {item.leads}</span><span>Замеры: {item.measurements}</span><span>Заказы: {item.orders}</span><span>Завершено: {item.completed}</span><span>Просрочено: {item.overdue}</span><span>Заказы / заявки периода: {item.conversion === null ? "—" : `${item.conversion}%`}</span><span className="col-span-2 text-white">Продажи: {money(item.salesAmount)}</span></div></div>)}</div></Panel>}
    <Panel title="Последние заказы">{report.orders.length < report.summary.orders.current && <p className="mb-3 text-sm text-slate-400">Показано {report.orders.length} из {report.summary.orders.current}; полный список доступен в CSV.</p>}<div className="hidden overflow-x-auto md:block"><table className="w-full text-sm"><thead className="text-left text-slate-500"><tr>{["№","Клиент","Менеджер","Сумма","Цена производства","Маржа","Зарплата по заказу","Получено","Остаток","Статус"].map(x=><th key={x} className="px-3 py-2">{x}</th>)}</tr></thead><tbody>{report.orders.map(item=><tr key={item.id} className="border-t border-slate-800"><td className="px-3 py-3 font-semibold"><a className="text-blue-300 hover:text-blue-200" href={`/orders/${item.id}`}>{item.number}</a></td><td className="px-3">{item.client}</td><td className="px-3">{item.manager}</td><td className="px-3">{money(item.amount)}</td><td className={`px-3 ${item.productionPrice === null ? "font-semibold text-amber-300" : "text-cyan-300"}`}>{item.productionPrice === null ? "Не заполнена" : money(item.productionPrice)}</td><td className="px-3">{item.grossMargin === null ? "—" : money(item.grossMargin)}</td><td className="px-3">{money(item.payrollAccrued)}</td><td className="px-3">{money(item.received)}</td><td className="px-3">{money(item.remaining)}</td><td className="px-3">{item.status}</td></tr>)}</tbody></table></div><div className="grid gap-3 md:hidden">{report.orders.map(item=><a href={`/orders/${item.id}`} key={item.id} className="rounded-xl bg-slate-950 p-4"><div className="flex justify-between gap-3"><strong className="text-blue-300">{item.number}</strong><span className="text-xs text-slate-400">{item.status}</span></div><p className="mt-1 text-sm text-white">{item.client}</p><div className="mt-3 grid grid-cols-2 gap-1 text-xs text-slate-400"><span>Сумма {money(item.amount)}</span><span className={item.productionPrice === null ? "text-amber-300" : ""}>Производство {item.productionPrice === null ? "не заполнено" : money(item.productionPrice)}</span><span>Маржа {item.grossMargin === null ? "—" : money(item.grossMargin)}</span><span>Зарплата {money(item.payrollAccrued)}</span><span>Остаток {money(item.remaining)}</span></div></a>)}</div></Panel>
    {report.production.length > 0 && <Panel title="Производственная сводка"><div className="grid grid-cols-2 gap-3 md:grid-cols-4">{report.production.map(item=><Stat key={item.stage} label={item.stage} value={item.count}/>)}</div></Panel>}
  </>;
}
function MetricCard({title,metric,format}:{title:string;metric:ComparableMetric;format:(v:number)=>string}) { const up=(metric.changePercent??0)>=0; return <div className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4"><p className="truncate text-xs font-medium text-slate-400 sm:text-sm">{title}</p><p className="mt-2 truncate text-xl font-bold text-white sm:text-2xl">{format(metric.current)}</p><p className={`mt-2 flex items-center gap-1 text-xs ${metric.changePercent===null?"text-slate-500":up?"text-emerald-400":"text-rose-400"}`}>{metric.changePercent===null?"Нет базы сравнения":<>{up?<TrendingUp size={13}/>:<TrendingDown size={13}/>} {up?"+":""}{metric.changePercent}%</>}</p></div> }
function Panel({title,children}:{title:string;children:React.ReactNode}) { return <section className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5"><h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white"><BarChart3 size={19} className="text-blue-400"/>{title}</h2>{children}</section> }
function Stat({label,value}:{label:string;value:string|number}) { return <div className="min-w-0 rounded-xl bg-slate-950 p-3"><p className="truncate text-xs text-slate-500">{label}</p><p className="mt-1 truncate font-semibold text-white">{value}</p></div> }
function Loading() { return <div aria-label="Загрузка отчёта" className="space-y-5 animate-pulse"><div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({length:5},(_,i)=><div key={i} className="h-28 rounded-2xl bg-slate-800"/>)}</div><div className="grid gap-5 xl:grid-cols-2"><div className="h-72 rounded-2xl bg-slate-800"/><div className="h-72 rounded-2xl bg-slate-800"/></div></div> }
