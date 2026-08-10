"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  BanknoteArrowDown,
  BanknoteArrowUp,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  Factory,
  FileWarning,
  HandCoins,
  RefreshCw,
  Ruler,
  ShoppingBag,
  TriangleAlert,
  UserRoundCheck,
  Users,
  WalletCards,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Period = "today" | "week" | "month";
type ActivityItem = { id: string; title: string; subject: string; href: string; user: string | null; createdAt: string };
type SalesMetrics = {
  newLeads: number; activeLeads: number; overdueNextActions: number; proposalsSent: number;
  orders: number; activeOrders: number; readyForInstallation: number; overdueOrders: number;
  totalSales: number; receivedPrepayment: number; balanceToReceive: number; conversion: number;
  partnerBalancePayable?: number; payrollBalancePayable?: number; ordersWithoutPartner?: number;
  tasksToday: number; overdueTasks: number; measurementsToday: number; measurementsUpcoming: number;
  measurementsOverdue: number; proposalsNeedResponse: number; expensesForMonth?: number;
  activeEmployees?: number; clientsWithBalance?: number; partnerPayableOrders?: number;
  ordersWithoutContract?: number; productionPreparation?: number; productionPainting?: number;
  productionReady?: number; productionOverdue?: number;
};
type ManagerRow = { managerUserId: number; manager: string; newLeads: number; orders: number; totalSales: number; conversion: number };
type MeasurementAttention = { id: number; nextActionAt: string; nextActionComment?: string | null; client: { id: number; name: string; phone: string } };
type SalesPayload = { role: "DIRECTOR" | "MANAGER"; metrics: SalesMetrics; managers?: ManagerRow[]; measurementAttention?: MeasurementAttention[]; activities: ActivityItem[] };
type AccountantPayload = { role: "ACCOUNTANT"; metrics: { receipts: number; expenses: number; partnerPayable: number; payrollPayable: number; pendingPayrollPayments: number; attentionOperations: number }; recentFinance: Array<{ id: number; type: string; category: string; direction: string; amount: string; operationDate: string; comment?: string | null }> };
type ProductionPayload = { role: "PRODUCTION"; metrics: { preparation: number; painting: number; readyForInstallation: number; overdue: number; tasksToday: number; attentionOrders: number; missingMaterials: number; readyMaterials: number }; jobs: Array<{ id: number; stage: string; percent: number; href: string; order: { number: string; client: { name: string; city: string } } }> };
type InstallationItem = { id: number; scheduledAt: string; href: string; order: { number: string; address: string; client: { name: string; city: string } } };
type InstallerPayload = { role: "INSTALLER"; metrics: { today: number; upcoming: number; overdue: number; assigned: number }; nextInstallation: InstallationItem | null; installations: InstallationItem[] };
type Payload = SalesPayload | AccountantPayload | ProductionPayload | InstallerPayload;

const periods: Record<Period, string> = { today: "Сегодня", week: "Неделя", month: "Месяц" };
const money = (value: number | string) => `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₸`;

export default function DirectorCockpit() {
  const { data: session } = useSession();
  const [period, setPeriod] = useState<Period>("month");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/dashboard/sales?period=${period}`, { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить показатели");
      setData(body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить показатели");
    } finally {
      setLoading(false);
    }
  }, [period]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const role = session?.user.role ?? data?.role;
  const isDirector = role === "DIRECTOR";
  const directorMetrics = data?.role === "DIRECTOR" ? data.metrics : null;

  return <section className="min-w-0 space-y-5 overflow-x-hidden p-4 text-slate-100 sm:p-6 md:p-8">
    {isDirector
      ? <DirectorHero metrics={directorMetrics} period={period} setPeriod={setPeriod} loading={loading} onRefresh={load}/>
      : <WorkspaceHeader role={role} period={period} setPeriod={setPeriod} loading={loading} onRefresh={load}/>
    }
    {error && <div role="alert" className="rounded-2xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">{error}</div>}
    {loading && !data
      ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-900"/>)}</div>
      : data && <Projection data={data}/>
    }
  </section>;
}

function DirectorHero({ metrics, period, setPeriod, loading, onRefresh }: { metrics: SalesMetrics | null; period: Period; setPeriod: (period: Period) => void; loading: boolean; onRefresh: () => Promise<void> }) {
  return <header className="relative overflow-hidden rounded-[28px] border border-amber-300/20 bg-[#0b1220] p-5 shadow-2xl shadow-black/20 sm:p-7">
    <div className="absolute inset-x-0 top-0 h-px bg-amber-300/70"/>
    <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
      <div className="max-w-2xl">
        <p className="text-xs font-bold uppercase tracking-[0.28em] text-amber-300">Director dashboard</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Состояние компании</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400 sm:text-base">Краткий статус бизнеса за выбранный период</p>
      </div>
      <DashboardControls period={period} setPeriod={setPeriod} loading={loading} onRefresh={onRefresh}/>
    </div>
    <div className="relative mt-7 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
      <HeroMetric icon={<CircleDollarSign size={19}/>} label="Продажи" value={metrics ? money(metrics.totalSales) : "—"} href="/orders"/>
      <HeroMetric icon={<BanknoteArrowUp size={19}/>} label="Получено от клиентов" value={metrics ? money(metrics.receivedPrepayment) : "—"} href="/finance"/>
      <HeroMetric icon={<WalletCards size={19}/>} label="К получению от клиентов" value={metrics ? money(metrics.balanceToReceive) : "—"} href="/orders?settlement=client-payable"/>
      <HeroMetric icon={<HandCoins size={19}/>} label="К выплате партнёрам" value={metrics ? money(metrics.partnerBalancePayable ?? 0) : "—"} href="/orders?settlement=partner-payable"/>
    </div>
  </header>;
}

function WorkspaceHeader({ role, period, setPeriod, loading, onRefresh }: { role?: string; period: Period; setPeriod: (period: Period) => void; loading: boolean; onRefresh: () => Promise<void> }) {
  const titles: Record<string, [string, string]> = {
    MANAGER: ["МОИ ПОКАЗАТЕЛИ", "Рабочий стол менеджера"],
    ACCOUNTANT: ["ФИНАНСЫ", "Рабочий стол бухгалтера"],
    PRODUCTION: ["ПРОИЗВОДСТВО", "Работа цеха сегодня"],
    INSTALLER: ["МОНТАЖ", "Мои установки"],
  };
  return <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
    <div><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">{titles[role ?? ""]?.[0]}</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{titles[role ?? ""]?.[1] ?? "Dashboard"}</h1><p className="mt-1 text-sm text-slate-400">Реальные данные · Asia/Almaty</p></div>
    {(role === "MANAGER" || role === "ACCOUNTANT")
      ? <DashboardControls period={period} setPeriod={setPeriod} loading={loading} onRefresh={onRefresh}/>
      : <RefreshButton loading={loading} onRefresh={onRefresh}/>
    }
  </header>;
}

function DashboardControls({ period, setPeriod, loading, onRefresh }: { period: Period; setPeriod: (period: Period) => void; loading: boolean; onRefresh: () => Promise<void> }) {
  return <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
    <div className="grid grid-cols-3 rounded-xl border border-white/10 bg-black/20 p-1">{(Object.keys(periods) as Period[]).map((value) => <button type="button" key={value} onClick={() => setPeriod(value)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold transition sm:px-4 ${period === value ? "bg-amber-300 text-slate-950" : "text-slate-300 hover:bg-white/5"}`}>{periods[value]}</button>)}</div>
    <RefreshButton loading={loading} onRefresh={onRefresh}/>
  </div>;
}

function RefreshButton({ loading, onRefresh }: { loading: boolean; onRefresh: () => Promise<void> }) {
  return <button type="button" onClick={() => void onRefresh()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-900 px-4 font-semibold text-slate-100 transition hover:border-amber-300/40 disabled:opacity-60"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/>Обновить</button>;
}

function Projection({ data }: { data: Payload }) {
  if (data.role === "DIRECTOR" || data.role === "MANAGER") return <SalesDashboard data={data}/>;
  if (data.role === "ACCOUNTANT") return <AccountantDashboard data={data}/>;
  if (data.role === "PRODUCTION") return <ProductionDashboard data={data}/>;
  if (data.role === "INSTALLER") return <InstallerDashboard data={data}/>;
  return null;
}

function SalesDashboard({ data }: { data: SalesPayload }) {
  if (data.role === "DIRECTOR") return <>
    <DirectorSalesDashboard metrics={data.metrics} managers={data.managers ?? []}/>
    <DirectorActivityFeed activities={data.activities}/>
  </>;
  return <>
    <ManagerSalesDashboard metrics={data.metrics} attention={data.measurementAttention ?? []}/>
    <Panel title="Последние важные действия"><LegacyActivityFeed activities={data.activities}/></Panel>
  </>;
}

function DirectorSalesDashboard({ metrics: m, managers }: { metrics: SalesMetrics; managers: ManagerRow[] }) {
  const overdueTotal = m.overdueNextActions + m.overdueOrders + m.overdueTasks + m.measurementsOverdue;
  const sortedManagers = [...managers].sort((left, right) => right.totalSales - left.totalSales || right.orders - left.orders);
  const maxManagerSales = Math.max(...sortedManagers.map((manager) => manager.totalSales), 1);
  const production = [
    { label: "На подготовке", value: m.productionPreparation ?? 0, tone: "bg-slate-400" },
    { label: "На покраске", value: m.productionPainting ?? 0, tone: "bg-blue-400" },
    { label: "Готово", value: m.productionReady ?? 0, tone: "bg-emerald-400" },
    { label: "Просрочено", value: m.productionOverdue ?? 0, tone: "bg-red-400" },
  ];
  const productionTotal = Math.max(production.reduce((sum, item) => sum + item.value, 0), 1);

  return <div className="space-y-5">
    <section aria-label="Ключевые показатели" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <OperationalMetric icon={<ClipboardList size={19}/>} href="/clients" label="Заявки" value={m.newLeads} detail={`${m.activeLeads} активных`} progress={m.conversion}/>
      <OperationalMetric icon={<ShoppingBag size={19}/>} href="/orders" label="Заказы" value={m.orders} detail={`${m.activeOrders} в работе`} progress={m.orders ? Math.round(m.readyForInstallation / m.orders * 100) : 0}/>
      <OperationalMetric icon={<Ruler size={19}/>} href="/measurements" label="Замеры сегодня" value={m.measurementsToday} detail={`${m.measurementsOverdue} требуют закрытия`}/>
      <OperationalMetric icon={<TriangleAlert size={19}/>} href="/calendar?state=overdue" label="Просрочено / требует внимания" value={overdueTotal} detail={overdueTotal ? "Нужно проверить сегодня" : "Работа идёт стабильно"} alert={overdueTotal > 0}/>
    </section>

    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.65fr)]">
      <SectionShell eyebrow="Приоритет" title="Требует внимания" icon={<TriangleAlert size={20}/>}>
        <div className="grid gap-2 sm:grid-cols-2">
          <AttentionLink href="/orders?settlement=without-partner" label="Заказы без партнёра" value={m.ordersWithoutPartner ?? 0} icon={<Factory size={17}/>}/>
          <AttentionLink href="/orders?settlement=client-payable" label="Клиенты с остатком" value={m.clientsWithBalance ?? 0} icon={<WalletCards size={17}/>}/>
          <AttentionLink href="/orders?settlement=without-contract" label="Заказы без договора" value={m.ordersWithoutContract ?? 0} icon={<FileWarning size={17}/>}/>
          <AttentionLink href="/calendar?state=overdue" label="Просроченные задачи" value={m.overdueTasks} icon={<CalendarClock size={17}/>}/>
          <AttentionLink href="/measurements?filter=needs-closing" label="Замеры, требующие закрытия" value={m.measurementsOverdue} icon={<Ruler size={17}/>}/>
          <AttentionLink href="/orders?settlement=partner-payable" label="Заказы к выплате партнёру" value={m.partnerPayableOrders ?? 0} icon={<HandCoins size={17}/>}/>
        </div>
        {!overdueTotal && !(m.ordersWithoutPartner ?? 0) && !(m.clientsWithBalance ?? 0) && !(m.ordersWithoutContract ?? 0) && <StableState text="Нет новых проблем — операционная работа идёт стабильно."/>}
      </SectionShell>

      <SectionShell eyebrow="Деньги" title="Финансы" href="/finance" hrefLabel="Открыть финансы" icon={<CircleDollarSign size={20}/>}>
        <div className="space-y-1">
          <FinanceRow href="/orders?settlement=client-payable" label="Остаток клиентов" value={money(m.balanceToReceive)} icon={<BanknoteArrowUp size={17}/>}/>
          <FinanceRow href="/orders?settlement=partner-payable" label="К выплате партнёрам" value={money(m.partnerBalancePayable ?? 0)} icon={<HandCoins size={17}/>}/>
          <FinanceRow href="/payroll" label="К выплате сотрудникам" value={money(m.payrollBalancePayable ?? 0)} icon={<Users size={17}/>}/>
          <FinanceRow href="/finance" label="Расходы за месяц" value={money(m.expensesForMonth ?? 0)} icon={<BanknoteArrowDown size={17}/>}/>
        </div>
      </SectionShell>
    </div>

    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
      <SectionShell eyebrow="Performance" title="Команда" href="/employees" icon={<UserRoundCheck size={20}/>} aside={`${m.activeEmployees ?? 0} активных`}>
        <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8 text-sm">
          <Link href="/employees" className="bg-black/15 p-3"><span className="block text-xs text-slate-500">Активные сотрудники</span><strong className="mt-1 block text-white">{m.activeEmployees ?? 0}</strong></Link>
          <Link href="/payroll" className="bg-black/15 p-3"><span className="block text-xs text-slate-500">Payroll к выплате</span><strong className="mt-1 block break-words text-white">{money(m.payrollBalancePayable ?? 0)}</strong></Link>
        </div>
        {sortedManagers.length ? <div className="space-y-2">{sortedManagers.map((manager, index) => <article key={manager.managerUserId} className="rounded-2xl border border-white/8 bg-black/15 p-4">
          <div className="flex min-w-0 items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-amber-300/30 bg-amber-300/10 text-sm font-bold text-amber-200">{index + 1}</span><div className="min-w-0"><h3 className="truncate font-semibold text-white">{manager.manager}</h3><p className="mt-0.5 text-xs text-slate-500">Конверсия {manager.conversion}%</p></div></div>
            <strong className="shrink-0 text-sm text-white sm:text-base">{money(manager.totalSales)}</strong>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-xs"><TeamStat label="Заявки" value={manager.newLeads}/><TeamStat label="Заказы" value={manager.orders}/><TeamStat label="Конверсия" value={`${manager.conversion}%`}/></div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-amber-300" style={{ width: `${Math.max(4, Math.round(manager.totalSales / maxManagerSales * 100))}%` }}/></div>
        </article>)}</div> : <Empty text="Активных менеджеров пока нет."/>}
        <Link href="/payroll" className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-blue-300 hover:text-blue-200"><BriefcaseBusiness size={16}/>Открыть начисления команды<ArrowUpRight size={15}/></Link>
      </SectionShell>

      <SectionShell eyebrow="Operations" title="Производство" href="/production" icon={<Factory size={20}/>}>
        <div className="mb-5 flex h-2 overflow-hidden rounded-full bg-slate-800">{production.filter((item) => item.value > 0).map((item) => <span key={item.label} className={item.tone} style={{ width: `${item.value / productionTotal * 100}%` }}/>)}</div>
        <div className="grid grid-cols-2 gap-3">{production.map((item) => <Link href="/production" key={item.label} className="rounded-xl border border-white/8 bg-black/10 p-3 transition hover:border-white/20"><div className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${item.tone}`}/><span className="text-xs text-slate-400">{item.label}</span></div><strong className={`mt-2 block text-2xl ${item.label === "Просрочено" && item.value ? "text-red-300" : "text-white"}`}>{item.value}</strong></Link>)}</div>
        {!production.some((item) => item.value) && <StableState text="Производственных задач за период нет."/>}
      </SectionShell>
    </div>
  </div>;
}

function DirectorActivityFeed({ activities }: { activities: ActivityItem[] }) {
  return <SectionShell eyebrow="Timeline" title="Последние важные действия" href="/reports" icon={<Activity size={20}/>}>
    {activities.length ? <div className="space-y-1">{activities.map((item, index) => <Link key={item.id} href={item.href} className="group grid min-w-0 grid-cols-[36px_minmax(0,1fr)] gap-3 rounded-xl p-2 transition hover:bg-white/5 sm:grid-cols-[36px_minmax(0,1fr)_auto] sm:items-center">
      <span className="relative grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-slate-900 text-amber-300"><Activity size={15}/>{index < activities.length - 1 && <span className="absolute left-1/2 top-9 h-4 w-px bg-white/10"/>}</span>
      <span className="min-w-0"><strong className="block truncate text-sm text-white group-hover:text-amber-200">{item.subject}</strong><span className="mt-0.5 block truncate text-xs text-slate-400">{item.title} · {item.user ?? "Система"}</span></span>
      <time className="col-start-2 text-xs text-slate-500 sm:col-start-3 sm:row-start-1">{new Date(item.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</time>
    </Link>)}</div> : <StableState text="Важных действий пока нет — новые события появятся здесь."/>}
  </SectionShell>;
}

function ManagerSalesDashboard({ metrics: m, attention }: { metrics: SalesMetrics; attention: MeasurementAttention[] }) {
  return <><div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
    <Metric href="/clients" label="Мои новые заявки" value={m.newLeads} featured/>
    <Metric href="/clients" label="Мои активные заявки" value={m.activeLeads} featured/>
    <Metric href="/orders" label="Мои заказы" value={m.orders} featured/>
    <Metric href="/orders" label="Мои продажи" value={money(m.totalSales)} featured/>
    <Metric href="/clients" label="Мои отправленные КП" value={m.proposalsSent}/>
    <Metric href="/measurements" label="Мои замеры сегодня" value={m.measurementsToday}/>
    <Metric href="/calendar" label="Мои задачи сегодня" value={m.tasksToday}/>
    <Metric href="/calendar?state=overdue" label="Мои просроченные" value={m.overdueNextActions + m.overdueTasks + m.overdueOrders} alert/>
  </div><Panel title="Требует внимания после замера">{attention.length ? <div className="grid gap-2 md:grid-cols-2">{attention.map((item) => <Link key={item.id} href={`/clients/${item.client.id}`} className="min-w-0 rounded-xl border border-amber-800/60 bg-amber-950/20 p-3 hover:border-amber-500"><b className="block truncate text-white">{item.client.name || item.client.phone}</b><span className="mt-1 block break-words text-sm text-amber-200">{item.nextActionComment || "Замер выполнен — требуется работа менеджера"}</span><time className="mt-2 block text-xs text-slate-500">до {new Date(item.nextActionAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</time></Link>)}</div> : <Empty text="Новых результатов замеров, требующих внимания, нет."/>}</Panel></>;
}

function LegacyActivityFeed({ activities }: { activities: ActivityItem[] }) {
  return activities.length ? <div className="divide-y divide-slate-800">{activities.map((item) => <Link key={item.id} href={item.href} className="flex min-w-0 flex-col gap-1 py-3 hover:text-blue-300 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0"><strong className="block truncate text-white">{item.subject}</strong><span className="block truncate text-sm text-slate-400">{item.title} · {item.user ?? "Система"}</span></span><time className="shrink-0 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</time></Link>)}</div> : <Empty text="Важных действий пока нет."/>;
}

function AccountantDashboard({ data }: { data: AccountantPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric href="/finance" label="Поступления" value={money(m.receipts)} featured/><Metric href="/finance" label="Расходы" value={money(m.expenses)} featured/><Metric href="/partners" label="К выплате партнёрам" value={money(m.partnerPayable)}/><Metric href="/payroll" label="Payroll к выплате" value={money(m.payrollPayable)}/><Metric href="/payroll" label="Ожидают выплаты" value={m.pendingPayrollPayments}/><Metric href="/finance" label="Требуют внимания" value={m.attentionOperations} alert/></div><Panel title="Последние финансовые операции" href="/finance">{data.recentFinance.length ? <div className="divide-y divide-slate-800">{data.recentFinance.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0"><b className="block truncate text-white">{item.category}</b><span className="block truncate text-slate-400">{item.comment || item.type}</span></span><b className={item.direction === "INCOME" ? "text-emerald-300" : "text-red-300"}>{item.direction === "INCOME" ? "+" : "−"}{money(item.amount)}</b></div>)}</div> : <Empty text="Финансовых операций за период нет."/>}</Panel></>; }
function ProductionDashboard({ data }: { data: ProductionPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric href="/production" label="На заготовке" value={m.preparation} featured/><Metric href="/production" label="На покраске" value={m.painting} featured/><Metric href="/production" label="Готово к установке" value={m.readyForInstallation}/><Metric href="/production" label="Просрочено" value={m.overdue} alert/><Metric href="/calendar" label="Задачи сегодня" value={m.tasksToday}/><Metric href="/production" label="Требуют внимания" value={m.attentionOrders} alert/><Metric href="/warehouse" label="Материалов не хватает" value={m.missingMaterials} alert/><Metric href="/warehouse" label="Материалы готовы" value={m.readyMaterials}/></div><Panel title="Заказы, требующие внимания" href="/production">{data.jobs.length ? <div className="grid gap-2 md:grid-cols-2">{data.jobs.map((job) => <Link key={job.id} href={job.href} className="min-w-0 rounded-xl border border-slate-800 p-3 hover:border-blue-500"><b className="block truncate text-white">{job.order.number} · {job.order.client.name}</b><span className="text-sm text-slate-400">{job.stage} · {job.percent}% · {job.order.client.city}</span></Link>)}</div> : <Empty text="Работа ещё не начата."/>}</Panel></>; }
function InstallerDashboard({ data }: { data: InstallerPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric href="/production" label="Установки сегодня" value={m.today} featured/><Metric href="/production" label="Предстоящие" value={m.upcoming} featured/><Metric href="/production" label="Просроченные" value={m.overdue} alert/><Metric href="/orders" label="Назначенные заказы" value={m.assigned}/></div><Panel title="Следующая установка" href="/production">{data.nextInstallation ? <Link href={data.nextInstallation.href} className="block min-w-0 rounded-xl border border-blue-500/40 bg-blue-500/10 p-4"><b className="block truncate text-white">{data.nextInstallation.order.client.name} · {data.nextInstallation.order.number}</b><span className="block truncate text-sm text-slate-300">{data.nextInstallation.order.client.city} · {data.nextInstallation.order.address}</span><time className="mt-2 block text-blue-300">{new Date(data.nextInstallation.scheduledAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</time></Link> : <Empty text="Назначенных установок нет."/>}</Panel></>; }

function HeroMetric({ icon, label, value, href }: { icon: ReactNode; label: string; value: string; href: string }) { return <Link href={href} className="group min-w-0 bg-[#0e1727] p-4 transition hover:bg-[#111d30] sm:p-5"><span className="flex items-center gap-2 text-xs font-medium text-slate-400"><span className="text-amber-300">{icon}</span>{label}</span><strong className="mt-4 block break-words text-xl font-semibold tracking-tight text-white group-hover:text-amber-100 sm:text-2xl">{value}</strong><span className="mt-3 flex items-center gap-1 text-xs text-slate-500 group-hover:text-slate-300">Открыть<ArrowUpRight size={13}/></span></Link>; }
function OperationalMetric({ icon, label, value, detail, href, progress, alert = false }: { icon: ReactNode; label: string; value: number; detail: string; href: string; progress?: number; alert?: boolean }) { const safeProgress = Math.min(100, Math.max(0, progress ?? 0)); return <Link href={href} className="group min-w-0 rounded-2xl border border-white/8 bg-[#101827] p-4 transition hover:border-amber-300/30 sm:p-5"><div className="flex items-center justify-between gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-white/5 text-slate-300 group-hover:text-amber-300">{icon}</span>{alert && <span className="rounded-full bg-red-400/10 px-2 py-1 text-[11px] font-semibold text-red-300">Внимание</span>}</div><div className="mt-5 flex items-end justify-between gap-3"><div className="min-w-0"><p className="text-sm text-slate-400">{label}</p><strong className={`mt-1 block text-3xl font-semibold ${alert ? "text-red-200" : "text-white"}`}>{value}</strong></div><ArrowUpRight size={17} className="mb-1 shrink-0 text-slate-600 group-hover:text-amber-300"/></div><p className="mt-3 truncate text-xs text-slate-500">{detail}</p>{progress !== undefined && <div className="mt-3 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-amber-300" style={{ width: `${safeProgress}%` }}/></div>}</Link>; }
function AttentionLink({ label, value, href, icon }: { label: string; value: number; href: string; icon: ReactNode }) { return <Link href={href} className="group flex min-h-16 items-center gap-3 rounded-xl border border-white/8 bg-black/10 p-3 transition hover:border-amber-300/35 hover:bg-amber-300/5"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${value > 0 ? "bg-amber-300/10 text-amber-300" : "bg-white/5 text-slate-500"}`}>{icon}</span><span className="min-w-0 flex-1 text-sm text-slate-300">{label}</span><strong className={value > 0 ? "text-amber-200" : "text-slate-500"}>{value}</strong><ArrowUpRight size={14} className="text-slate-600 group-hover:text-amber-300"/></Link>; }
function FinanceRow({ label, value, href, icon }: { label: string; value: string; href: string; icon: ReactNode }) { return <Link href={href} className="group flex min-w-0 items-center gap-3 rounded-xl px-2 py-3 transition hover:bg-white/5"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/5 text-slate-400 group-hover:text-amber-300">{icon}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs text-slate-500">{label}</span><strong className="mt-0.5 block break-words text-sm text-white sm:text-base">{value}</strong></span><ArrowUpRight size={14} className="shrink-0 text-slate-600 group-hover:text-amber-300"/></Link>; }
function TeamStat({ label, value }: { label: string; value: number | string }) { return <span className="rounded-lg bg-white/[0.03] p-2"><span className="block text-slate-500">{label}</span><strong className="mt-1 block text-sm text-slate-200">{value}</strong></span>; }
function StableState({ text }: { text: string }) { return <div className="mt-3 flex items-center gap-2 rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-sm text-emerald-200"><CheckCircle2 size={17} className="shrink-0"/>{text}</div>; }
function SectionShell({ eyebrow, title, icon, href, hrefLabel = "Открыть", aside, children }: { eyebrow: string; title: string; icon: ReactNode; href?: string; hrefLabel?: string; aside?: string; children: ReactNode }) { return <section className="min-w-0 rounded-[24px] border border-white/8 bg-[#101827] p-4 shadow-lg shadow-black/10 sm:p-5"><div className="mb-5 flex min-w-0 items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-white/8 bg-white/[0.03] text-amber-300">{icon}</span><div className="min-w-0"><p className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p><h2 className="mt-1 truncate text-lg font-semibold text-white sm:text-xl">{title}</h2></div></div>{href ? <Link href={href} className="inline-flex min-h-10 shrink-0 items-center gap-1 text-xs font-semibold text-blue-300 hover:text-blue-200">{hrefLabel}<ArrowUpRight size={14}/></Link> : aside && <span className="shrink-0 rounded-full bg-white/5 px-3 py-1.5 text-xs text-slate-400">{aside}</span>}</div>{children}</section>; }
function Metric({ label, value, href, alert = false, featured = false }: { label: string; value: number | string; href: string; alert?: boolean; featured?: boolean }) { return <Link href={href} className={`min-w-0 rounded-xl border p-3 transition hover:border-blue-500 sm:p-4 ${featured ? "border-blue-500/40 bg-blue-500/10" : "border-slate-700 bg-[#101827]"}`}><p className="text-xs text-slate-400 sm:text-sm">{label}</p><p className={`mt-2 break-words font-bold ${featured ? "text-xl sm:text-3xl" : "text-lg sm:text-2xl"} ${alert && Number(value) > 0 ? "text-red-300" : "text-white"}`}>{value}</p></Link>; }
function Panel({ title, href, children }: { title: string; href?: string; children: ReactNode }) { return <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-white sm:text-xl">{title}</h2>{href && <Link href={href} className="shrink-0 text-sm text-blue-300">Открыть</Link>}</div>{children}</section>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">{text}</p>; }
