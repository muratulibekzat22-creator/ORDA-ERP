"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Banknote, Factory, RefreshCw, ShoppingBag, UsersRound } from "lucide-react";
import { isProductionOverdue } from "@/lib/production/kanban";
import type { ProductionKanbanItem } from "@/components/production/ProductionKanban";

type Period = "today" | "week" | "month";
type Analytics = {
  kpi: { leads: number; measurements: number; contracts: number; contractAmount: number; received: number; averageCheck: number };
  byManager: Array<{ manager: string; leads: number; contracts: number; amount: number; received: number; averageCheck: number }>;
};
type Finance = { totals: { turnover: number; clientBalance: number; partnerBalance: number; profit: number }; operationTotals: { income: number; expense: number; net: number } };
type Warehouse = { stats: { lowStock: number } };

const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const periodNames: Record<Period, string> = { today: "Сегодня", week: "Неделя", month: "Месяц" };

function range(period: Period) {
  const to = new Date();
  const from = new Date(to);
  if (period === "today") from.setHours(0, 0, 0, 0);
  if (period === "week") from.setDate(to.getDate() - 7);
  if (period === "month") from.setMonth(to.getMonth() - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export default function DirectorCockpit() {
  const [period, setPeriod] = useState<Period>("month");
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [production, setProduction] = useState<ProductionKanbanItem[]>([]);
  const [productionAvailable, setProductionAvailable] = useState(false);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const dates = range(period);
    try {
      const requests = await Promise.allSettled([
        period === "month" ? fetch("/api/analytics?period=month", { cache: "no-store" }) : Promise.resolve(null),
        fetch(`/api/finance?from=${encodeURIComponent(dates.from)}&to=${encodeURIComponent(dates.to)}`, { cache: "no-store" }),
        fetch("/api/production", { cache: "no-store" }),
        fetch("/api/warehouse?page=1&pageSize=1", { cache: "no-store" }),
      ]);
      const [analyticsResult, financeResult, productionResult, warehouseResult] = requests;
      if (analyticsResult.status === "fulfilled" && analyticsResult.value?.ok) setAnalytics(await analyticsResult.value.json() as Analytics);
      else setAnalytics(null);
      if (financeResult.status === "fulfilled" && financeResult.value.ok) setFinance(await financeResult.value.json() as Finance);
      else setFinance(null);
      if (productionResult.status === "fulfilled" && productionResult.value.ok) { setProduction(await productionResult.value.json() as ProductionKanbanItem[]); setProductionAvailable(true); }
      else { setProduction([]); setProductionAvailable(false); }
      if (warehouseResult.status === "fulfilled" && warehouseResult.value.ok) setWarehouse(await warehouseResult.value.json() as Warehouse);
      else setWarehouse(null);
      if (requests.some((item) => item.status === "rejected" || (item.status === "fulfilled" && item.value && !item.value.ok))) setError("Часть показателей недоступна. Доступные данные показаны без подстановок.");
    } catch {
      setError("Не удалось загрузить cockpit. Повторите попытку.");
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const productionKpi = useMemo(() => ({
    inProgress: production.filter((item) => item.stage !== "Сдано").length,
    overdue: production.filter((item) => isProductionOverdue(item)).length,
    ready: production.filter((item) => item.stage === "Готово к монтажу").length,
    installation: production.filter((item) => item.stage === "Монтаж").length,
    completed: production.filter((item) => item.stage === "Сдано").length,
  }), [production]);

  return (
    <section className="space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">DIRECTOR COCKPIT</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">Состояние компании</h1><p className="mt-1 text-slate-400">Критические показатели и доступная управленческая сводка.</p></div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div role="group" aria-label="Период" className="grid grid-cols-3 rounded-xl border border-slate-700 bg-slate-900 p-1">
            {(Object.keys(periodNames) as Period[]).map((value) => <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)} className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${period === value ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}>{periodNames[value]}</button>)}
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold text-white disabled:opacity-50"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/>Обновить</button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-200">{error}</p>}

      <Attention productionOverdue={productionAvailable ? productionKpi.overdue : undefined} lowStock={warehouse?.stats.lowStock} />

      <Section title="Продажи" icon={ShoppingBag} href="/analytics">
        {analytics ? <MetricGrid items={[
          ["Новые заявки", analytics.kpi.leads], ["Замеры", analytics.kpi.measurements], ["Оформленные заказы", analytics.kpi.contracts], ["Продажи", money(analytics.kpi.contractAmount)], ["Средний чек", money(analytics.kpi.averageCheck)],
        ]}/> : <Unavailable text="Sales funnel доступен backend только за месяц." />}
        <Unavailable compact text="KPI «КП отправлено» отсутствует в analytics contract." />
      </Section>

      <Section title="Деньги" icon={Banknote} href="/finance">
        {finance ? <MetricGrid items={[[`Поступления · ${periodNames[period].toLowerCase()}`, money(finance.operationTotals.income)], ["Задолженность клиентов · сейчас", money(finance.totals.clientBalance)], ["Обязательства перед ЦЕХ · сейчас", money(finance.totals.partnerBalance)], ["Оборот · сейчас", money(finance.totals.turnover)], ["Доступная прибыль · сейчас", money(finance.totals.profit)]]}/> : <Unavailable text="Финансовая сводка недоступна для выбранного периода." />}
      </Section>

      <Section title="Производство" icon={Factory} href="/production">
        {productionAvailable ? <MetricGrid items={[["В работе", productionKpi.inProgress], ["Просрочено", productionKpi.overdue, "critical"], ["Готово к монтажу", productionKpi.ready], ["Монтаж", productionKpi.installation], ["Завершено", productionKpi.completed]]}/> : <Unavailable text="Производственная сводка недоступна."/>}
      </Section>

      <Section title="Менеджеры" icon={UsersRound} href="/analytics">
        {analytics?.byManager.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{analytics.byManager.map((manager) => <article key={manager.manager} className="rounded-xl border border-slate-700 bg-slate-900 p-4"><h3 className="font-bold text-white">{manager.manager}</h3><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><Mini label="Заявки" value={manager.leads}/><Mini label="Заказы" value={manager.contracts}/><Mini label="КП" value="Нет данных" muted/><Mini label="Замеры" value="Нет данных" muted/></dl></article>)}</div> : <Unavailable text={period === "month" ? "Данных по менеджерам пока нет." : "Разрез менеджеров доступен backend только за месяц."}/>} 
      </Section>
    </section>
  );
}

function Attention({ productionOverdue, lowStock }: { productionOverdue?: number; lowStock?: number }) {
  const total = (productionOverdue ?? 0) + (lowStock ?? 0);
  return <section aria-labelledby="attention-title" className={`rounded-2xl border p-5 ${total ? "border-red-500/50 bg-red-950/30" : "border-slate-700 bg-[#101827]"}`}><div className="flex items-center gap-3"><AlertTriangle className={total ? "text-red-400" : "text-slate-500"}/><div><h2 id="attention-title" className="text-lg font-bold text-white">Требует внимания</h2><p className="text-sm text-slate-400">Только сигналы, доступные в текущих API.</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2">{productionOverdue === undefined ? <Unavailable compact text="Производство недоступно"/> : <Signal href="/production" label="Просроченное производство" value={productionOverdue}/>}{lowStock === undefined ? <Unavailable compact text="Склад недоступен"/> : <Signal href="/warehouse" label="Низкие остатки" value={lowStock}/>}</div><p className="mt-4 text-xs text-slate-500">Просроченные follow-up и price approvals отсутствуют в текущих API contracts.</p></section>;
}

function Section({ title, icon: Icon, href, children }: { title: string; icon: typeof ShoppingBag; href: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5"><header className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-3"><Icon className="text-blue-400"/><h2 className="text-xl font-bold text-white">{title}</h2></div><Link href={href} className="min-h-11 rounded-lg px-3 py-2 text-sm font-semibold text-blue-300 hover:bg-slate-800">Подробнее</Link></header>{children}</section>; }
function MetricGrid({ items }: { items: Array<[string, string | number, string?]> }) { return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">{items.map(([label, value, tone]) => <article key={label} className={`rounded-xl border p-4 ${tone === "critical" && Number(value) > 0 ? "border-red-500/50 bg-red-950/30" : "border-slate-700 bg-slate-900"}`}><p className="text-sm text-slate-400">{label}</p><p className={`mt-2 break-words text-2xl font-bold ${tone === "critical" && Number(value) > 0 ? "text-red-300" : "text-white"}`}>{value}</p></article>)}</div>; }
function Mini({ label, value, muted }: { label: string; value: string | number; muted?: boolean }) { return <div><dt className="text-slate-500">{label}</dt><dd className={muted ? "text-xs text-slate-500" : "text-lg font-bold text-white"}>{value}</dd></div>; }
function Signal({ href, label, value }: { href: string; label: string; value: number }) { return <Link href={href} className="flex min-h-14 items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-4 hover:border-slate-600"><span className="text-sm text-slate-300">{label}</span><strong className={value ? "text-xl text-red-300" : "text-xl text-emerald-300"}>{value}</strong></Link>; }
function Unavailable({ text, compact }: { text: string; compact?: boolean }) { return <p className={`rounded-xl border border-dashed border-slate-700 text-slate-500 ${compact ? "mt-3 p-3 text-xs" : "p-5 text-sm"}`}>{text}</p>; }
