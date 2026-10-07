"use client";

import { Save, Target, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Tier = { id?: number; thresholdPercent: number; label: string; rewardAmount: number };
type Manager = {
  managerId: number;
  managerName: string;
  actualRevenue: number;
  actualOrders: number;
  targetRevenue: number | null;
  targetOrders: number | null;
  targetCompletionPercent: number | null;
  contributionPercent: number;
  marginCoveragePercent: number;
  grossMarginPercent: number;
};
type Payload = {
  month: string;
  canEdit: boolean;
  plan: {
    revenueTarget: number;
    orderTarget: number;
    recommendationRevenue: number;
    recommendationOrders: number;
    recommendationBasis: { note?: string } | null;
    minimumMarginPercent: number;
    requiredCostCoveragePercent: number;
    marketingBudgetTarget: number;
    inquiryTarget: number;
    applicationTarget: number;
    tiers: Tier[];
  };
  actual: {
    revenue: number;
    orders: number;
    averageOrder: number;
    progressPercent: number;
    gap: number;
    projectedRevenue: number | null;
    projectionDays: number;
    marginCoveragePercent: number;
    pricedOrders: number;
    pricedRevenue: number;
    grossMargin: number;
    grossMarginPercent: number;
    pendingOrderDates: number;
    bonusEligible: boolean;
    bonusBlockers: string[];
    achievedTier: Tier | null;
    nextTier: (Tier & { remainingRevenue: number }) | null;
  };
  history: Array<{
    month: string;
    revenue: number;
    orders: number;
    averageOrder: number;
    marginCoveragePercent: number;
    grossMarginPercent: number;
  }>;
  managers: Manager[];
  ledger: {
    source: string;
    today: { date: string; revenue: number; orders: number };
    days: Array<{
      date: string;
      revenue: number;
      orders: number;
      items: Array<{ id: number; number: string; client: string; manager: string; amount: number }>;
    }>;
  };
  dailyFunnel: {
    daysInMonth: number;
    elapsedDays: number;
    remainingDays: number;
    trackingReady: boolean;
    overallStatus: PaceStatus | "data_missing";
    targets: {
      revenueMonth: number;
      revenueDay: number;
      spendMonth: number;
      spendDay: number;
      inquiriesMonth: number;
      inquiriesDay: number;
      applicationsMonth: number;
      applicationsDay: number;
      ordersMonth: number;
      ordersDay: number;
    };
    actual: { revenue: number; spend: number; inquiries: number; applications: number; orders: number };
    expectedToDate: { revenue: number; spend: number; inquiries: number; applications: number; orders: number };
    neededPerRemainingDay: { revenue: number; spend: number; inquiries: number; applications: number; orders: number };
    pace: { revenue: PaceStatus; inquiries: PaceStatus; applications: PaceStatus; orders: PaceStatus };
    economics: {
      targetCostPerInquiry: number;
      targetCostPerApplication: number;
      targetCustomerAcquisitionCost: number;
      marketingSharePercent: number;
      inquiryToApplicationPercent: number;
      applicationToOrderPercent: number;
    };
  };
};

type PaceStatus = "ahead" | "on_track" | "behind" | "not_started";

const currentMonth = () => new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString().slice(0, 7);
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;

export default function SalesPlanPage() {
  const params = useSearchParams();
  const [month, setMonth] = useState(params.get("month") || currentMonth());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setMessage("");
    try {
      const response = await fetch(`/api/sales-plan?month=${encodeURIComponent(month)}`, { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить план");
      setData(body);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не удалось загрузить план");
    } finally { setLoading(false); }
  }, [month]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  async function save() {
    if (!data) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/sales-plan", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          month,
          revenueTarget: data.plan.revenueTarget,
          orderTarget: data.plan.orderTarget,
          minimumMarginPercent: data.plan.minimumMarginPercent,
          requiredCostCoveragePercent: data.plan.requiredCostCoveragePercent,
          marketingBudgetTarget: data.plan.marketingBudgetTarget,
          inquiryTarget: data.plan.inquiryTarget,
          applicationTarget: data.plan.applicationTarget,
          tiers: data.plan.tiers,
        }),
      });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить план");
      setData(body); setMessage("План сохранён");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Не удалось сохранить план"); }
    finally { setSaving(false); }
  }
  const patchPlan = (patch: Partial<Payload["plan"]>) => setData((current) => current ? { ...current, plan: { ...current.plan, ...patch } } : current);
  const patchManager = (managerId: number, patch: Partial<Manager>) => setData((current) => current ? { ...current, managers: current.managers.map((manager) => manager.managerId === managerId ? { ...manager, ...patch } : manager) } : current);
  async function saveManagerTarget(manager: Manager) {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/sales-plan/manager-targets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month, managerId: manager.managerId, revenueTarget: manager.targetRevenue, orderTarget: manager.targetOrders }),
      });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось сохранить план менеджера");
      setData(body); setMessage(`План ${manager.managerName} сохранён`);
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Не удалось сохранить план менеджера"); }
    finally { setSaving(false); }
  }
  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-5 p-4 pb-24 text-slate-100 sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-[#101827] p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-blue-300">Продажи</p><h1 className="mt-2 flex items-center gap-2 text-3xl font-bold text-white"><Target/>Командный план месяца</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Общий план компании и личные цели менеджеров. Личные цели назначает директор; факт продаж система берёт из подтверждённых заказов.</p></div>
        <div className="flex gap-2"><input aria-label="Месяц плана" type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3"/>{data?.canEdit ? <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50"><Save size={17}/>{saving ? "Сохраняем…" : "Сохранить"}</button> : null}</div>
      </header>
      {message ? <p className={`rounded-xl border p-3 text-sm ${message === "План сохранён" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : "border-amber-500/30 bg-amber-500/10 text-amber-200"}`}>{message}</p> : null}
      {loading || !data ? <div className="h-64 animate-pulse rounded-2xl bg-slate-900"/> : <>
        {data.actual.pendingOrderDates > 0 ? <Link href="/orders?tab=all&attention=order-date" className="block rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-sm leading-6 text-amber-100 hover:border-amber-400"><b>{data.actual.pendingOrderDates} заказов временно не включены в продажи месяца.</b> Менеджеру нужно открыть карточки и подтвердить фактическую дату договора. Дата ввода заказа в ORDA в расчёте не используется.</Link> : null}
        <section className="rounded-2xl border border-blue-500/25 bg-blue-500/5 p-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <Metric label="Продажи" value={money(data.actual.revenue)} hint={`${data.actual.orders} заказов`}/>
            <Metric label="План" value={money(data.plan.revenueTarget)} hint={`${data.plan.orderTarget} заказов`}/>
            <Metric label="Выполнение" value={`${data.actual.progressPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`} hint={`Осталось ${money(data.actual.gap)}`}/>
            <Metric label="Прогноз месяца" value={data.actual.projectedRevenue === null ? "Рано считать" : money(data.actual.projectedRevenue)} hint={data.actual.projectedRevenue === null ? "Покажем после 7 полных дней — до этого цифра вводит в заблуждение" : `По фактическому темпу за ${data.actual.projectionDays} дн.`}/>
            <Metric label="Средний чек" value={money(data.actual.averageOrder)} hint={`Цена цеха заполнена на ${data.actual.marginCoveragePercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`}/>
            <Metric label="Валовая маржа" value={`${data.actual.grossMarginPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%`} hint={`${money(data.actual.grossMargin)} по заказам с ценой производства`}/>
          </div>
          <div className="mt-5 h-3 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(Math.max(data.actual.progressPercent, 0), 100)}%` }}/></div>
        </section>
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-300">Откуда взялась сумма</p><h2 className="mt-1 text-xl font-bold">Продажи по дням и заказам</h2><p className="mt-1 text-sm text-slate-400">{data.ledger.source}. Сегодня: <b className="text-white">{money(data.ledger.today.revenue)}</b> · {data.ledger.today.orders} заказов.</p></div><span className="rounded-full bg-slate-950 px-3 py-2 text-sm text-slate-300">Месяц: {data.month}</span></div>
          <div className="mt-4 space-y-3">{data.ledger.days.map((day) => <details key={day.date} open={day.orders > 0} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><summary className="cursor-pointer list-none"><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-semibold text-white">{new Date(`${day.date}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long" })}</span><span className={day.orders ? "font-bold text-emerald-300" : "text-slate-500"}>{money(day.revenue)} · {day.orders} заказов</span></div></summary>{day.items.length ? <div className="mt-3 divide-y divide-slate-800">{day.items.map((item) => <Link key={item.id} href={`/orders/${item.id}`} className="grid gap-1 py-3 text-sm hover:text-blue-200 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><span><b>{item.number}</b> · {item.client}</span><span className="text-slate-400">Рабочий кабинет: {item.manager}</span><b>{money(item.amount)}</b></Link>)}</div> : <p className="mt-3 text-sm text-slate-500">В этот день новых продаж не было.</p>}</details>)}</div>
        </section>
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Контроль каждый день</p><h2 className="mt-1 text-xl font-bold">Темп рекламной воронки</h2><p className="mt-1 text-sm text-slate-400">Показывает, успевает ли команда к утверждённому плану {money(data.plan.revenueTarget)} по состоянию на сегодняшний день.</p></div><span className={`rounded-full border px-3 py-1 text-sm font-semibold ${overallTone(data.dailyFunnel.overallStatus)}`}>{overallLabel(data.dailyFunnel.overallStatus)}</span></div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <PaceMetric label="Продажи в день" daily={money(data.dailyFunnel.targets.revenueDay)} actual={money(data.dailyFunnel.actual.revenue)} expected={money(data.dailyFunnel.expectedToDate.revenue)} status={data.dailyFunnel.pace.revenue}/>
            <PaceMetric label="Реклама в день" daily={money(data.dailyFunnel.targets.spendDay)} actual={money(data.dailyFunnel.actual.spend)} expected={money(data.dailyFunnel.expectedToDate.spend)} status={data.dailyFunnel.trackingReady ? "on_track" : "not_started"}/>
            <PaceMetric label="Обращений в день" daily={`${Math.ceil(data.dailyFunnel.targets.inquiriesDay)} чел.`} actual={`${data.dailyFunnel.actual.inquiries} чел.`} expected={`${Math.ceil(data.dailyFunnel.expectedToDate.inquiries)} чел.`} status={data.dailyFunnel.pace.inquiries}/>
            <PaceMetric label="Заявок в ORDA в день" daily={`${Math.ceil(data.dailyFunnel.targets.applicationsDay)} шт.`} actual={`${data.dailyFunnel.actual.applications} шт.`} expected={`${Math.ceil(data.dailyFunnel.expectedToDate.applications)} шт.`} status={data.dailyFunnel.pace.applications}/>
            <PaceMetric label="Заказы" daily={`${data.dailyFunnel.targets.ordersDay.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} в день`} actual={`${data.dailyFunnel.actual.orders} шт.`} expected={`${data.dailyFunnel.expectedToDate.orders.toLocaleString("ru-RU", { maximumFractionDigits: 1 })} шт.`} status={data.dailyFunnel.pace.orders}/>
          </div>
          <div className="mt-4 grid gap-3 rounded-xl bg-slate-950/60 p-4 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-4"><p>До конца месяца ежедневно: <strong className="text-white">{money(data.dailyFunnel.neededPerRemainingDay.revenue)}</strong> продаж</p><p><strong className="text-white">{Math.ceil(data.dailyFunnel.neededPerRemainingDay.inquiries)}</strong> обращений и <strong className="text-white">{Math.ceil(data.dailyFunnel.neededPerRemainingDay.applications)}</strong> заявок</p><p>Допустимая цена обращения: <strong className="text-white">до {money(data.dailyFunnel.economics.targetCostPerInquiry)}</strong></p><p>Допустимая цена заказа: <strong className="text-white">до {money(data.dailyFunnel.economics.targetCustomerAcquisitionCost)}</strong></p></div>
          {!data.dailyFunnel.trackingReady ? <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Нет синхронизированных данных Meta за этот месяц. Проверьте одноразовое подключение рекламного кабинета в разделе «Маркетинг»; ежедневный ручной ввод не требуется, заявки и заказы ORDA считает автоматически.</p> : null}
        </section>
        {data.canEdit ? <details className="rounded-2xl border border-slate-800 bg-[#101827] p-5"><summary className="cursor-pointer list-none"><div><h2 className="text-lg font-bold">Изменить план и нормативы</h2><p className="mt-1 text-sm text-slate-400">Текущий командный план — {money(data.plan.revenueTarget)}. Откройте только когда действительно нужно изменить цифры.</p></div></summary><div className="mt-5 border-t border-slate-800 pt-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">Ручная настройка</h3><p className="mt-1 text-sm text-slate-400">Автоматическая справка: {money(data.plan.recommendationRevenue)} и {data.plan.recommendationOrders} заказов. Она сама не меняет утверждённый план.</p></div><button type="button" onClick={() => patchPlan({ revenueTarget: data.plan.recommendationRevenue, orderTarget: data.plan.recommendationOrders })} className="rounded-xl border border-blue-500/30 px-3 py-2 text-sm font-semibold text-blue-200">Подставить справочную цифру</button></div><p className="mt-3 rounded-xl bg-slate-950/60 p-3 text-sm text-slate-400">{data.plan.recommendationBasis?.note || "По фактической истории продаж."}</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><NumberField label="План продаж, ₸" value={data.plan.revenueTarget} onChange={(value) => patchPlan({ revenueTarget: value })}/><NumberField label="План заказов" value={data.plan.orderTarget} step={1} onChange={(value) => patchPlan({ orderTarget: value })}/><NumberField label="Минимальная валовая маржа, %" value={data.plan.minimumMarginPercent} step={0.1} max={100} onChange={(value) => patchPlan({ minimumMarginPercent: value })}/><NumberField label="Цена производства заполнена, %" value={data.plan.requiredCostCoveragePercent} step={0.1} max={100} onChange={(value) => patchPlan({ requiredCostCoveragePercent: value })}/></div><h3 className="mt-5 font-bold text-white">Рекламная воронка на месяц</h3><div className="mt-3 grid gap-3 sm:grid-cols-3"><NumberField label="Бюджет Meta, ₸" value={data.plan.marketingBudgetTarget} onChange={(value) => patchPlan({ marketingBudgetTarget: value })}/><NumberField label="Обращения / сообщения" value={data.plan.inquiryTarget} step={1} onChange={(value) => patchPlan({ inquiryTarget: value })}/><NumberField label="Оформленные заявки в ORDA" value={data.plan.applicationTarget} step={1} onChange={(value) => patchPlan({ applicationTarget: value })}/></div></div></details> : null}
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5"><div className="flex items-center gap-2"><TrendingUp className="text-emerald-300"/><div><h2 className="text-xl font-bold">Командная мотивация</h2><p className="text-sm text-slate-400">Уровень определяется по общему результату команды</p></div></div><p className={`mt-4 rounded-xl border p-3 text-sm ${data.actual.bonusEligible ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-100" : "border-amber-500/20 bg-amber-500/5 text-amber-100"}`}>{data.actual.bonusEligible ? "Команда выполнила все условия бонуса." : `Бонус пока недоступен: ${data.actual.bonusBlockers.join(" · ")}.`} Цена производства должна быть заполнена минимум на {data.plan.requiredCostCoveragePercent}%, валовая маржа — не ниже {data.plan.minimumMarginPercent}%.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{data.plan.tiers.map((tier, index) => <article key={tier.id ?? tier.thresholdPercent} className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-2xl font-bold text-white">{tier.thresholdPercent}% команды</p>{data.canEdit ? <><input value={tier.label} onChange={(event) => patchPlan({ tiers: data.plan.tiers.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item) })} className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 p-2"/><NumberField label="Командный бонус, ₸" value={tier.rewardAmount} onChange={(value) => patchPlan({ tiers: data.plan.tiers.map((item, itemIndex) => itemIndex === index ? { ...item, rewardAmount: value } : item) })}/></> : <><p className="mt-2 font-semibold">{tier.label}</p><p className="mt-1 text-sm text-emerald-300">{tier.rewardAmount ? money(tier.rewardAmount) : "Без денежного бонуса"}</p></>}</article>)}</div></section>
        <section id="manager-kpi" className="scroll-mt-6 rounded-2xl border border-slate-800 bg-[#101827] p-5"><h2 className="text-xl font-bold">KPI менеджеров · {data.month}</h2><p className="mt-1 text-sm text-slate-400">Факт берётся из заказов с подтверждённой датой. Личный план задаёт директор; пустой план не заменяется системной догадкой. Сохранение общего плана не удаляет личные цели.</p><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[860px] text-sm"><thead className="text-left text-slate-400"><tr>{["Менеджер", "План продаж", "Факт продаж", "Выполнение", "План заказов", "Факт заказов", "Действие"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{data.managers.map((manager) => <tr key={manager.managerId} className="border-t border-slate-800"><td className="px-3 py-4 font-semibold text-white">{manager.managerName}</td><td className="px-3">{data.canEdit ? <input aria-label={`План продаж ${manager.managerName}`} type="number" min="1" step="1000" value={manager.targetRevenue ?? ""} onChange={(event) => patchManager(manager.managerId, { targetRevenue: event.target.value ? Number(event.target.value) : null })} placeholder="Не задан" className="w-36 rounded-lg border border-slate-700 bg-slate-950 p-2"/> : manager.targetRevenue === null ? "Не задан директором" : money(manager.targetRevenue)}</td><td className="px-3 font-semibold tabular-nums text-emerald-200">{money(manager.actualRevenue)}</td><td className="px-3 font-bold tabular-nums text-blue-200">{manager.targetRevenue && manager.targetRevenue > 0 ? `${(manager.actualRevenue / manager.targetRevenue * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%` : "—"}</td><td className="px-3">{data.canEdit ? <input aria-label={`План заказов ${manager.managerName}`} type="number" min="1" step="1" value={manager.targetOrders ?? ""} onChange={(event) => patchManager(manager.managerId, { targetOrders: event.target.value ? Number(event.target.value) : null })} placeholder="Не задан" className="w-24 rounded-lg border border-slate-700 bg-slate-950 p-2"/> : manager.targetOrders ?? "—"}</td><td className="px-3 tabular-nums">{manager.actualOrders}</td><td className="px-3">{data.canEdit ? <button type="button" disabled={saving} onClick={() => void saveManagerTarget(manager)} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50">Сохранить</button> : "Директор назначает план"}</td></tr>)}</tbody></table>{!data.managers.length ? <p className="py-8 text-center text-slate-400">Активных менеджеров нет. Проверьте роли сотрудников.</p> : null}</div></section>
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5"><h2 className="text-xl font-bold">Основание плана</h2><div className="mt-4 grid gap-3 sm:grid-cols-3">{data.history.map((row) => <Metric key={row.month} label={row.month} value={money(row.revenue)} hint={`${row.orders} заказов · средний чек ${money(row.averageOrder)} · цена производства ${row.marginCoveragePercent}% · маржа ${row.grossMarginPercent}%`}/>)}</div></section>
      </>}
    </main>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) { return <article className="rounded-xl bg-slate-950/60 p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 break-words text-xl font-bold text-white">{value}</p><p className="mt-1 text-xs leading-5 text-slate-500">{hint}</p></article>; }
function overallLabel(status: Payload["dailyFunnel"]["overallStatus"]) { return status === "data_missing" ? "Нет данных Meta" : status === "behind" ? "Отстаём" : status === "on_track" ? "Почти по плану" : status === "ahead" ? "Идём с опережением" : "Месяц не начался"; }
function overallTone(status: Payload["dailyFunnel"]["overallStatus"]) { return status === "ahead" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200" : status === "on_track" ? "border-blue-500/30 bg-blue-500/10 text-blue-200" : status === "not_started" ? "border-slate-700 bg-slate-900 text-slate-300" : "border-amber-500/30 bg-amber-500/10 text-amber-200"; }
function paceLabel(status: PaceStatus) { return status === "ahead" ? "По плану" : status === "on_track" ? "Почти по плану" : status === "behind" ? "Отстаём" : "Нет данных"; }
function PaceMetric({ label, daily, actual, expected, status }: { label: string; daily: string; actual: string; expected: string; status: PaceStatus }) { return <article className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex items-start justify-between gap-2"><p className="text-sm text-slate-400">{label}</p><span className={`text-xs font-semibold ${status === "ahead" ? "text-emerald-300" : status === "on_track" ? "text-blue-300" : status === "behind" ? "text-amber-300" : "text-slate-500"}`}>{paceLabel(status)}</span></div><p className="mt-2 text-xl font-bold text-white">{daily}</p><p className="mt-2 text-xs leading-5 text-slate-500">Факт: {actual}<br/>Должно быть сейчас: {expected}</p></article>; }
function NumberField({ label, value, onChange, compact = false, step, max }: { label: string; value: number; onChange: (value: number) => void; compact?: boolean; step?: number; max?: number }) { return <label className={compact ? "mt-1 block" : "block"}><span className={`${compact ? "text-[10px]" : "text-sm"} text-slate-500`}>{label}</span><input type="number" min="0" max={max} step={step ?? (compact ? 1 : 1000)} value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${compact ? "w-32 p-1.5 text-xs" : "mt-1 w-full p-3"} rounded-lg border border-slate-700 bg-slate-900 text-white`}/></label>; }
