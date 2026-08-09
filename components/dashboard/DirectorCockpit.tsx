"use client";

import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Period = "today" | "week" | "month";
type Activity = { id: string; title: string; subject: string; href: string; user: string | null; createdAt: string };
type SalesMetrics = { newLeads: number; activeLeads: number; overdueNextActions: number; orders: number; totalSales: number; receivedPrepayment: number; balanceToReceive: number; partnerBalancePayable?: number; payrollBalancePayable?: number; tasksToday: number; overdueTasks: number; overdueOrders: number; measurementsToday: number; proposalsNeedResponse: number };
type ManagerRow = { managerUserId: number; manager: string; newLeads: number; orders: number; totalSales: number };
type SalesPayload = { role: "DIRECTOR" | "MANAGER"; metrics: SalesMetrics; managers?: ManagerRow[]; activities: Activity[] };
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
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/dashboard/sales?period=${period}`, { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить показатели");
      setData(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить показатели"); }
    finally { setLoading(false); }
  }, [period]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const role = session?.user.role ?? data?.role;
  const titles: Record<string, [string, string]> = {
    DIRECTOR: ["DIRECTOR DASHBOARD", "Состояние компании"], MANAGER: ["МОИ ПОКАЗАТЕЛИ", "Рабочий стол менеджера"],
    ACCOUNTANT: ["ФИНАНСЫ", "Рабочий стол бухгалтера"], PRODUCTION: ["ПРОИЗВОДСТВО", "Работа цеха сегодня"], INSTALLER: ["МОНТАЖ", "Мои установки"],
  };
  return <section className="min-w-0 space-y-5 overflow-x-hidden p-4 sm:p-6 md:p-8">
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div><p className="text-sm font-semibold uppercase tracking-widest text-amber-400">{titles[role ?? ""]?.[0]}</p><h1 className="mt-1 text-2xl font-bold text-white sm:text-3xl">{titles[role ?? ""]?.[1] ?? "Dashboard"}</h1><p className="mt-1 text-sm text-slate-400">Реальные данные · Asia/Almaty</p></div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {(role === "DIRECTOR" || role === "MANAGER" || role === "ACCOUNTANT") && <div className="grid grid-cols-3 rounded-xl border border-slate-700 bg-slate-900 p-1">{(Object.keys(periods) as Period[]).map((value) => <button key={value} onClick={() => setPeriod(value)} className={`min-h-11 rounded-lg px-2 text-sm font-semibold sm:px-4 ${period === value ? "bg-blue-600 text-white" : "text-slate-300"}`}>{periods[value]}</button>)}</div>}
        <button onClick={() => void load()} disabled={loading} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold"><RefreshCw size={18} className={loading ? "animate-spin" : ""}/>Обновить</button>
      </div>
    </header>
    {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</div>}
    {loading && !data ? <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-xl bg-slate-900"/>)}</div> : data && <Projection data={data}/>}
  </section>;
}

function Projection({ data }: { data: Payload }) {
  if (data.role === "DIRECTOR" || data.role === "MANAGER") return <SalesDashboard data={data}/>;
  if (data.role === "ACCOUNTANT") return <AccountantDashboard data={data}/>;
  if (data.role === "PRODUCTION") return <ProductionDashboard data={data}/>;
  if (data.role === "INSTALLER") return <InstallerDashboard data={data}/>;
  return null;
}

function SalesDashboard({ data }: { data: SalesPayload }) {
  const m = data.metrics, director = data.role === "DIRECTOR";
  return <>
    <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-4">
      {director ? <><Metric href="/orders" label="Продажи" value={money(m.totalSales)} featured/><Metric href="/finance" label="Получено" value={money(m.receivedPrepayment)} featured/><Metric href="/finance" label="К получению от клиентов" value={money(m.balanceToReceive)}/><Metric href="/orders?settlement=partner-payable" label="К выплате партнёрам" value={money(m.partnerBalancePayable ?? 0)}/><Metric href="/payroll" label="К выплате сотрудникам" value={money(m.payrollBalancePayable ?? 0)}/></>
      : <><Metric href="/clients" label="Мои новые заявки" value={m.newLeads} featured/><Metric href="/clients" label="Мои активные заявки" value={m.activeLeads} featured/><Metric href="/orders" label="Мои заказы" value={m.orders} featured/><Metric href="/orders" label="Мои продажи" value={money(m.totalSales)} featured/><Metric href="/measurements" label="Мои замеры сегодня" value={m.measurementsToday}/><Metric href="/calendar" label="Мои задачи сегодня" value={m.tasksToday}/><Metric href="/clients" label="Просроченные действия" value={m.overdueNextActions} alert/><Metric href="/clients" label="КП требуют ответа" value={m.proposalsNeedResponse} alert/></>}
    </div>
    {director && <Panel title="Менеджеры" href="/analytics">{data.managers?.length ? <div className="overflow-x-auto"><table className="w-full min-w-[540px] text-left text-sm"><thead className="text-slate-400"><tr>{["Менеджер", "Заявки", "Заказы", "Продажи"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead><tbody>{data.managers.map((manager) => <tr key={manager.managerUserId} className="border-t border-slate-800"><td className="p-3 font-semibold text-white">{manager.manager}</td><td className="p-3">{manager.newLeads}</td><td className="p-3">{manager.orders}</td><td className="p-3">{money(manager.totalSales)}</td></tr>)}</tbody></table></div> : <Empty text="Работа ещё не начата."/>}</Panel>}
    <Panel title="Последние важные действия">{data.activities.length ? <div className="divide-y divide-slate-800">{data.activities.map((item) => <Link key={item.id} href={item.href} className="flex min-w-0 flex-col gap-1 py-3 hover:text-blue-300 sm:flex-row sm:items-center sm:justify-between"><span className="min-w-0"><strong className="block truncate text-white">{item.subject}</strong><span className="block truncate text-sm text-slate-400">{item.title} · {item.user ?? "Система"}</span></span><time className="shrink-0 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</time></Link>)}</div> : <Empty text="Важных действий пока нет."/>}</Panel>
  </>;
}

function AccountantDashboard({ data }: { data: AccountantPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-6"><Metric href="/finance" label="Поступления" value={money(m.receipts)} featured/><Metric href="/finance" label="Расходы" value={money(m.expenses)} featured/><Metric href="/partners" label="К выплате партнёрам" value={money(m.partnerPayable)}/><Metric href="/payroll" label="Payroll к выплате" value={money(m.payrollPayable)}/><Metric href="/payroll" label="Ожидают выплаты" value={m.pendingPayrollPayments}/><Metric href="/finance" label="Требуют внимания" value={m.attentionOperations} alert/></div><Panel title="Последние финансовые операции" href="/finance">{data.recentFinance.length ? <div className="divide-y divide-slate-800">{data.recentFinance.map((item) => <div key={item.id} className="flex items-center justify-between gap-3 py-3 text-sm"><span className="min-w-0"><b className="block truncate text-white">{item.category}</b><span className="block truncate text-slate-400">{item.comment || item.type}</span></span><b className={item.direction === "INCOME" ? "text-emerald-300" : "text-red-300"}>{item.direction === "INCOME" ? "+" : "−"}{money(item.amount)}</b></div>)}</div> : <Empty text="Финансовых операций за период нет."/>}</Panel></>; }
function ProductionDashboard({ data }: { data: ProductionPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric href="/production" label="На заготовке" value={m.preparation} featured/><Metric href="/production" label="На покраске" value={m.painting} featured/><Metric href="/production" label="Готово к установке" value={m.readyForInstallation}/><Metric href="/production" label="Просрочено" value={m.overdue} alert/><Metric href="/calendar" label="Задачи сегодня" value={m.tasksToday}/><Metric href="/production" label="Требуют внимания" value={m.attentionOrders} alert/><Metric href="/warehouse" label="Материалов не хватает" value={m.missingMaterials} alert/><Metric href="/warehouse" label="Материалы готовы" value={m.readyMaterials}/></div><Panel title="Заказы, требующие внимания" href="/production">{data.jobs.length ? <div className="grid gap-2 md:grid-cols-2">{data.jobs.map((job) => <Link key={job.id} href={job.href} className="min-w-0 rounded-xl border border-slate-800 p-3 hover:border-blue-500"><b className="block truncate text-white">{job.order.number} · {job.order.client.name}</b><span className="text-sm text-slate-400">{job.stage} · {job.percent}% · {job.order.client.city}</span></Link>)}</div> : <Empty text="Работа ещё не начата."/>}</Panel></>; }
function InstallerDashboard({ data }: { data: InstallerPayload }) { const m = data.metrics; return <><div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric href="/production" label="Установки сегодня" value={m.today} featured/><Metric href="/production" label="Предстоящие" value={m.upcoming} featured/><Metric href="/production" label="Просроченные" value={m.overdue} alert/><Metric href="/orders" label="Назначенные заказы" value={m.assigned}/></div><Panel title="Следующая установка" href="/production">{data.nextInstallation ? <Link href={data.nextInstallation.href} className="block min-w-0 rounded-xl border border-blue-500/40 bg-blue-500/10 p-4"><b className="block truncate text-white">{data.nextInstallation.order.client.name} · {data.nextInstallation.order.number}</b><span className="block truncate text-sm text-slate-300">{data.nextInstallation.order.client.city} · {data.nextInstallation.order.address}</span><time className="mt-2 block text-blue-300">{new Date(data.nextInstallation.scheduledAt).toLocaleString("ru-RU", { timeZone: "Asia/Almaty" })}</time></Link> : <Empty text="Назначенных установок нет."/>}</Panel></>; }

function Metric({ label, value, href, alert = false, featured = false }: { label: string; value: number | string; href: string; alert?: boolean; featured?: boolean }) { return <Link href={href} className={`min-w-0 rounded-xl border p-3 transition hover:border-blue-500 sm:p-4 ${featured ? "border-blue-500/40 bg-blue-500/10" : "border-slate-700 bg-[#101827]"}`}><p className="text-xs text-slate-400 sm:text-sm">{label}</p><p className={`mt-2 break-words font-bold ${featured ? "text-xl sm:text-3xl" : "text-lg sm:text-2xl"} ${alert && Number(value) > 0 ? "text-red-300" : "text-white"}`}>{value}</p></Link>; }
function Panel({ title, href, children }: { title: string; href?: string; children: React.ReactNode }) { return <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-bold text-white sm:text-xl">{title}</h2>{href && <Link href={href} className="shrink-0 text-sm text-blue-300">Открыть</Link>}</div>{children}</section>; }
function Empty({ text }: { text: string }) { return <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-400">{text}</p>; }
