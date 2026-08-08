"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Period = "today" | "week" | "month";
type Activity = { id: string; title: string; subject: string; href: string; user: string | null; createdAt: string };
type SalesMetrics = {
  newLeads: number; activeLeads: number; overdueNextActions: number; proposalsSent: number;
  measurementsScheduled: number; orders: number; totalSales: number; receivedPrepayment: number;
  balanceToReceive: number; conversion: number; activeOrders: number; readyForInstallation: number;
  onInstallation: number; overdueOrders: number; lowStock: number; tasksToday: number; overdueTasks: number;
};
type ManagerRow = { managerUserId: number; manager: string; newLeads: number; measurementsScheduled: number; orders: number; totalSales: number; conversion: number };
type SalesPayload = { role: "DIRECTOR" | "MANAGER"; metrics: SalesMetrics; managers?: ManagerRow[]; activities: Activity[] };
type AccountantPayload = { role: "ACCOUNTANT"; metrics: { receipts: number; expenses: number; payrollPayable: number; pendingPayrollPayments: number; attentionOperations: number }; recentFinance: Array<{ id: number; type: string; category: string; direction: string; amount: string; operationDate: string; comment?: string | null }> };
type ProductionPayload = { role: "PRODUCTION"; metrics: { preparation: number; painting: number; readyForInstallation: number; overdue: number; availableTasks: number; missingMaterials: number }; jobs: Array<{ id: number; stage: string; percent: number; plannedEndAt?: string | null; masterUserId?: number | null; href: string; order: { number: string; client: { name: string; city: string } } }> };
type InstallerPayload = { role: "INSTALLER"; metrics: { today: number; upcoming: number; overdue: number; assigned: number }; installations: Array<{ id: number; scheduledAt: string; startedAt?: string | null; href: string; order: { number: string; address: string; client: { name: string; city: string } } }> };
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
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const role = session?.user.role ?? data?.role;
  const titles: Record<string, [string, string]> = {
    DIRECTOR: ["DIRECTOR DASHBOARD", "Состояние компании"],
    MANAGER: ["МОИ ПОКАЗАТЕЛИ", "Рабочий стол менеджера"],
    ACCOUNTANT: ["ФИНАНСЫ", "Рабочий стол бухгалтера"],
    PRODUCTION: ["ПРОИЗВОДСТВО", "Работа цеха сегодня"],
    INSTALLER: ["МОНТАЖ", "Мои установки"],
  };
  return (
    <section className="min-w-0 space-y-6 overflow-x-hidden p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">{titles[role ?? ""]?.[0]}</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{titles[role ?? ""]?.[1] ?? "Dashboard"}</h1><p className="mt-1 text-sm text-slate-400">Реальные данные за выбранный период · Asia/Almaty</p></div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(role === "DIRECTOR" || role === "MANAGER" || role === "ACCOUNTANT") && <div className="grid grid-cols-3 rounded-xl border border-slate-700 bg-slate-900 p-1">{(Object.keys(periods) as Period[]).map((value) => <button key={value} onClick={() => setPeriod(value)} className={`min-h-11 rounded-lg px-2 text-sm font-semibold sm:px-4 ${period === value ? "bg-blue-600 text-white" : "text-slate-300"}`}>{periods[value]}</button>)}</div>}
          <button onClick={() => void load()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/>Обновить</button>
        </div>
      </header>
      {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
      {loading && !data ? <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-900"/>)}</div> : data && <DashboardProjection data={data}/>}
    </section>
  );
}

function DashboardProjection({ data }: { data: Payload }) {
  switch (data.role) {
    case "DIRECTOR":
    case "MANAGER": return <SalesDashboard data={data}/>;
    case "ACCOUNTANT": return <AccountantDashboard data={data}/>;
    case "PRODUCTION": return <ProductionDashboard data={data}/>;
    case "INSTALLER": return <InstallerDashboard data={data}/>;
  }
}

function SalesDashboard({ data }: { data: SalesPayload }) {
  const m = data.metrics;
  const director = data.role === "DIRECTOR";
  return <>
    <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
      {director ? <><Metric href="/orders" label="Продажи" value={money(m.totalSales)} featured/><Metric href="/finance" label="Получено" value={money(m.receivedPrepayment)} featured/><Metric href="/finance" label="Осталось получить" value={money(m.balanceToReceive)}/><Metric href="/orders" label="Заказы" value={m.orders}/></> : <><Metric href="/clients" label="Мои новые заявки" value={m.newLeads} featured/><Metric href="/orders" label="Мои продажи" value={money(m.totalSales)} featured/><Metric href="/clients" label="Мои замеры" value={m.measurementsScheduled}/><Metric href="/calendar" label="Задачи сегодня" value={m.tasksToday}/></>}
    </div>
    <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Metric href="/clients" label={director ? "Новые заявки" : "Активные заявки"} value={director ? m.newLeads : m.activeLeads}/>
      {director && <Metric href="/clients" label="Активные заявки" value={m.activeLeads}/>}<Metric href="/clients" label="КП отправлено" value={m.proposalsSent}/><Metric href="/clients" label="Замеры" value={m.measurementsScheduled}/><Metric href="/clients" label="Конверсия" value={`${m.conversion}%`}/><Metric href="/clients" label="Просрочены следующие действия" value={m.overdueNextActions} alert/>
    </div>
    {director && <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7"><Metric href="/orders" label="Заказы в работе" value={m.activeOrders}/><Metric href="/orders" label="Готово к установке" value={m.readyForInstallation}/><Metric href="/orders" label="На установке" value={m.onInstallation}/><Metric href="/orders" label="Просроченные заказы" value={m.overdueOrders} alert/><Metric href="/calendar" label="Задачи сегодня" value={m.tasksToday}/><Metric href="/calendar" label="Просроченные задачи" value={m.overdueTasks} alert/><Metric href="/warehouse" label="Склад заканчивается" value={m.lowStock} alert/></div>}
    {director && <Panel title="Менеджеры" href="/analytics">{data.managers?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="text-slate-400"><tr>{["Менеджер", "Заявки", "Замеры", "Заказы", "Продажи", "Конверсия"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>{data.managers.map((manager) => <tr key={manager.managerUserId} className="border-t border-slate-800"><td className="p-3 font-semibold text-white">{manager.manager}</td><td className="p-3">{manager.newLeads}</td><td className="p-3">{manager.measurementsScheduled}</td><td className="p-3">{manager.orders}</td><td className="p-3">{money(manager.totalSales)}</td><td className="p-3">{manager.conversion}%</td></tr>)}</tbody></table></div> : <Empty text="Данных по менеджерам за период нет."/>}</Panel>}
    <Panel title="Последние важные действия">{data.activities.length ? <div className="divide-y divide-slate-800">{data.activities.map((item) => <Link key={item.id} href={item.href} className="flex min-w-0 flex-col gap-1 py-3 hover:text-blue-300 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0"><strong className="block truncate text-white">{item.subject}</strong><span className="block truncate text-sm text-slate-400">{item.title} · {item.user ?? "Система"}</span></span><time className="shrink-0 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("ru-RU")}</time></Link>)}</div> : <Empty text="Важных действий за период нет."/>}</Panel>
  </>;
}

function AccountantDashboard({ data }: { data: AccountantPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Metric href="/finance" label="Поступления" value={money(m.receipts)} featured/><Metric href="/finance" label="Расходы" value={money(m.expenses)} featured/><Metric href="/payroll" label="Payroll к выплате" value={money(m.payrollPayable)}/><Metric href="/payroll" label="Ожидают выплаты" value={m.pendingPayrollPayments}/><Metric href="/finance" label="Требуют внимания" value={m.attentionOperations} alert/></div><Panel title="Последние финансовые операции" href="/finance">{data.recentFinance.length ? <div className="divide-y divide-slate-800">{data.recentFinance.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0"><b className="block truncate text-white">{item.category}</b><span className="block truncate text-slate-400">{item.comment || item.type}</span></span><b className={item.direction === "INCOME" ? "text-emerald-300" : "text-red-300"}>{item.direction === "INCOME" ? "+" : "−"}{money(item.amount)}</b></div>)}</div> : <Empty text="Финансовых операций за период нет."/>}</Panel></>; }

function ProductionDashboard({ data }: { data: ProductionPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric href="/production" label="На заготовке" value={m.preparation} featured/><Metric href="/production" label="На покраске" value={m.painting} featured/><Metric href="/production" label="Готово к установке" value={m.readyForInstallation}/><Metric href="/production" label="Просрочено" value={m.overdue} alert/><Metric href="/production" label="Мои / доступные задачи" value={m.availableTasks}/><Metric href="/warehouse" label="Не хватает материалов" value={m.missingMaterials} alert/></div><Panel title="Мои и доступные задачи" href="/production">{data.jobs.length ? <div className="grid gap-2 md:grid-cols-2">{data.jobs.map((job) => <Link key={job.id} href={job.href} className="min-w-0 rounded-xl border border-slate-800 p-3 hover:border-blue-500"><b className="block truncate text-white">{job.order.number} · {job.order.client.name}</b><span className="text-sm text-slate-400">{job.stage} · {job.percent}% · {job.order.client.city}</span></Link>)}</div> : <Empty text="Доступных производственных задач нет."/>}</Panel></>; }

function InstallerDashboard({ data }: { data: InstallerPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric href="/production" label="Установки сегодня" value={m.today} featured/><Metric href="/production" label="Предстоящие" value={m.upcoming} featured/><Metric href="/production" label="Просроченные задачи" value={m.overdue} alert/><Metric href="/orders" label="Назначенные заказы" value={m.assigned}/></div><Panel title="Назначенные установки" href="/production">{data.installations.length ? <div className="grid gap-2 md:grid-cols-2">{data.installations.map((item) => <Link key={item.id} href={item.href} className="min-w-0 rounded-xl border border-slate-800 p-3 hover:border-blue-500"><b className="block truncate text-white">{item.order.number} · {item.order.client.name}</b><span className="block truncate text-sm text-slate-400">{item.order.client.city} · {item.order.address}</span><time className="text-sm text-blue-300">{new Date(item.scheduledAt).toLocaleString("ru-RU")}</time></Link>)}</div> : <Empty text="Назначенных установок нет."/>}</Panel></>; }

function Metric({ label, value, href, alert = false, featured = false }: { label: string; value: number | string; href: string; alert?: boolean; featured?: boolean }) { return <Link href={href} className={`min-w-0 rounded-xl border p-4 transition hover:border-blue-500 ${featured ? "border-blue-500/40 bg-blue-500/10" : "border-slate-700 bg-[#101827]"}`}><p className="text-sm text-slate-400">{label}</p><p className={`mt-2 break-words font-bold ${featured ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl"} ${alert && Number(value) > 0 ? "text-red-300" : "text-white"}`}>{value}</p></Link>; }
function Panel({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-bold text-white">{title}</h2>{href && <Link href={href} className="shrink-0 text-sm text-blue-300">Открыть</Link>}</div>{children}</section>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">{text}</p>; }
