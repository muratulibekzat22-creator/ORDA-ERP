"use client";

import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  ClipboardList,
  Factory,
  Megaphone,
  Plus,
  RefreshCw,
  ReceiptText,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  USER_ORDER_STATUS_LABELS,
  type UserOrderStatus,
} from "@/lib/orders/presentation";
import CalendarAgenda from "@/components/dashboard/CalendarAgenda";
import SalesPlanCard from "@/components/sales-plan/SalesPlanCard";
import FounderControlPanel from "@/components/dashboard/FounderControlPanel";

type ManagementPayload = {
  role: "DIRECTOR" | "ACCOUNTANT";
  month: string;
  weekly: {
    from: string;
    to: string;
    orders: number;
    leads: number;
    revenue: number;
    received: number;
    ordersWithProductionPrice: number;
    activeOrders: number;
    overdueOrders: number;
    incompleteOrders: number;
    overdueTeamTasks: number;
  };
  finance: {
    revenue: number;
    received: number;
    receivedForPeriodOrders: number;
    receivedFromOtherOrders: number;
    customerPayments: Array<{
      id: number;
      orderId: number | null;
      orderNumber: string;
      orderReceivedAt: string | null;
      orderDateNeedsReview: boolean;
      operationDate: string;
      amount: number;
      fromPeriodOrder: boolean;
    }>;
    directExpenses: number;
    additionalIncome: number;
    operatingExpenses: number;
    payrollAccrued: number;
    payrollPaid: number;
    netProfit: number;
    netMargin: number | null;
    pricedRevenue: number;
    businessProfitability: number | null;
    dataComplete: boolean;
    ordersWithMargin: number;
    ordersWithoutMargin: number;
    customerOutstanding: number;
    activeProductionCost: number;
    activeOrdersWithProductionPrice: number;
    pendingOrderDates: number;
    productionCostOrders: Array<{ id: number; number: string; amount: number }>;
    operatingExpenseEntries: Array<{
      id: number;
      category: string;
      amount: number;
      operationDate: string;
      comment: string | null;
    }>;
  };
  orders: {
    active: number;
    beforeWorkshop: number;
    transferredToWorkshop: number;
    inWork: number;
    readyForInstallation: number;
    installation: number;
    overdue: number;
    missingProductionPrice: number;
    incompleteData: number;
  };
  attention: Array<{
    id: number;
    number: string;
    client: string;
    responsible: string;
    status: UserOrderStatus;
    deadline: string | null;
    balance: number;
    netProfit: number | null;
    netMargin: number | null;
    reasons: string[];
  }>;
  expenses: Array<{
    id: number;
    category: string;
    amount: number;
    operationDate: string;
    comment: string | null;
    orderId: number | null;
    orderNumber: string | null;
  }>;
  marketing: {
    spend: number;
    leads: number;
    orders: number;
    revenue: number;
    qualifiedShare: number | null;
    cpl: number | null;
    cac: number | null;
    roas: number | null;
    conversion: number | null;
    spendTracked: boolean;
    crmTracked: boolean;
    metaAttributionMissing: boolean;
  };
  team: Array<{
    id: number;
    name: string;
    role: string;
    lastLogin: string | null;
    activeDays: number;
    leads: number;
    orders: number;
    sales: number;
    completedTasks: number;
    overdueTasks: number;
  }>;
  salesTools: {
    designRecorded: number;
    designDone: number;
    designSkipped: number;
    designConverted: number;
    designConversion: number | null;
  };
  dailyCrm: DailyCrmPayload;
};

type DailyCrmPayload = {
  dateKey: string;
  dateLabel: string;
  totals: {
    leadsReceived: number;
    contacted: number;
    interested: number;
    measurementsScheduled: number;
    measurementsCompleted: number;
    ordersCreated: number;
    revenue: number;
  };
  managers: Array<{
    managerId: number;
    manager: string;
    leadsReceived: number;
    contacted: number;
    interested: number;
    measurementsScheduled: number;
    measurementsCompleted: number;
    ordersCreated: number;
    revenue: number;
    reportStatus: "NOT_SENT" | "ACKNOWLEDGED" | "SENT";
    reportTaskId: number | null;
    reportSubmittedAt: string | null;
  }>;
};

type ManagerPayload = {
  role: "MANAGER";
  orders: { active: number; overdue: number; missingProductionPrice: number; incompleteData: number };
  attention: Array<{
    id: number;
    number: string;
    client: string;
    status: UserOrderStatus;
    deadline: string | null;
    missingFields: string[];
    productionPriceMissing: boolean;
  }>;
  paymentFollowUps: Array<{
    id: number;
    dueAt: string;
    expectedAmount: string | number | null;
    acknowledgedAt: string | null;
    overdue: boolean;
    order: { id: number; number: string; client: { name: string; phone: string } } | null;
  }>;
  dailyCrm: DailyCrmPayload;
};
type OperationsPayload = Pick<ManagementPayload, "month" | "orders" | "marketing" | "team" | "salesTools" | "dailyCrm"> & {
  role: "OPERATIONS_DIRECTOR";
  attention: Array<Pick<ManagementPayload["attention"][number], "id" | "number" | "client" | "responsible" | "status" | "deadline" | "reasons">>;
};
type ProductionPayload = {
  role: "PRODUCTION";
  jobs: Array<{
    id: number;
    percent: number;
    plannedEndAt: string | null;
    href: string;
    status: UserOrderStatus;
    order: { number: string; client: { name: string } };
  }>;
};
type InstallerPayload = {
  role: "INSTALLER";
  installations: Array<{
    id: number;
    scheduledAt: string;
    href: string;
    order: { number: string; address: string; client: { name: string } };
  }>;
};
type Payload =
  | ManagementPayload
  | OperationsPayload
  | ManagerPayload
  | ProductionPayload
  | InstallerPayload;

const expenseCategories = [
  ["ADVERTISING", "Реклама"],
  ["RENT", "Аренда"],
  ["FUEL", "Топливо"],
  ["DELIVERY", "Доставка"],
  ["TAX", "Налоги"],
  ["ACCOUNTING", "Бухгалтерия"],
  ["COMMUNICATION", "Связь"],
  ["OFFICE", "Офис"],
  ["SERVICES", "Услуги"],
  ["EQUIPMENT", "Оборудование"],
  ["COMPANY_LOAN", "Заём компании"],
  ["OTHER", "Другое"],
] as const;
const incomeCategories = [
  ["OTHER_INCOME", "Прочий доход"],
  ["INVESTMENT", "Инвестиция"],
  ["REFUND_INCOME", "Возврат средств"],
  ["COMPANY_LOAN_INCOME", "Заём компании"],
] as const;
const expenseLabel = Object.fromEntries(expenseCategories);
const money = (value: number) =>
  `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const companyToday = () => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
};
const today = () => companyToday();
const currentMonth = () => companyToday().slice(0, 7);
const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Без срока";

export default function DirectorCockpit({ founder = false }: { founder?: boolean }) {
  const { data: session } = useSession();
  const operationsDirector = session?.user.accountRole === "OPERATIONS_DIRECTOR";
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [entryDirection, setEntryDirection] = useState<"INCOME" | "EXPENSE" | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/dashboard/sales?month=${encodeURIComponent(month)}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as Payload & { error?: string };
      if (!response.ok)
        throw new Error(body.error ?? "Не удалось загрузить показатели");
      setData(body);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось загрузить показатели",
      );
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 overflow-x-hidden p-4 pb-24 text-slate-100 sm:p-6 lg:p-8">
      <header className={`flex flex-col gap-4 border border-slate-800 bg-[#101827] lg:flex-row lg:items-end lg:justify-between ${founder ? "rounded-2xl p-4 sm:p-5" : "rounded-3xl p-5 sm:p-6"}`}>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">
            ORDA · ALTYN SAPA
          </p>
          <h1 className={`mt-2 font-bold text-white ${founder ? "text-2xl" : "text-3xl"}`}>{founder ? "Картина бизнеса" : "Главная"}</h1>
          <p className="mt-1 text-sm text-slate-400">
            {founder
              ? "Оборот, расходы, прибыль, заказы и команда — на одном экране."
              : operationsDirector
                ? "Заявки, замеры, заказы и задачи, которые требуют контроля."
                : "Деньги компании и состояние заказов — без лишних модулей."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(session?.user.role === "DIRECTOR" ||
            session?.user.role === "OPERATIONS_DIRECTOR" ||
            session?.user.role === "ACCOUNTANT") && (
            <input
              aria-label="Выбранный месяц"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
              className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"
            />
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold disabled:opacity-50"
          >
            <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
            Обновить
          </button>
        </div>
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200"
        >
          {error}
        </p>
      )}
      {loading && !data ? <DashboardSkeleton /> : null}
      {founder && <FounderControlPanel />}
      {data && !founder && ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(data.role) ? <SalesPlanCard month={month} /> : null}
      {data && !founder && "dailyCrm" in data && ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(data.role) ? <DailyCrmPanel data={data.dailyCrm} managerView={data.role === "MANAGER"} /> : null}
      {data?.role === "DIRECTOR" || data?.role === "ACCOUNTANT" ? (
        founder ? <FounderDashboard data={data} /> : (
          <ManagementDashboard
            data={data}
            historyOpen={historyOpen}
            onHistory={() => setHistoryOpen((value) => !value)}
            onAddEntry={setEntryDirection}
          />
        )
      ) : null}
      {data?.role === "OPERATIONS_DIRECTOR" ? <OperationsDashboard data={data} /> : null}
      {data?.role === "MANAGER" ? <ManagerDashboard data={data} /> : null}
      {data?.role === "PRODUCTION" ? <ProductionDashboard data={data} /> : null}
      {data?.role === "INSTALLER" ? <InstallerDashboard data={data} /> : null}

      {entryDirection && (
        <FinanceEntryDialog
          direction={entryDirection}
          onClose={() => setEntryDirection(null)}
          onSaved={async () => {
            setEntryDirection(null);
            await load();
          }}
        />
      )}
    </main>
  );
}

function percent(value: number | null) {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`;
}

function FounderDashboard({ data }: { data: ManagementPayload }) {
  const [detailsOpen, setDetailsOpen] = useState<"cash" | "costs" | "profit" | null>(null);
  const revealDetails = (view: "cash" | "costs" | "profit") => {
    setDetailsOpen(view);
    window.setTimeout(() => document.getElementById("founder-finance-details")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const totalOrders = data.finance.ordersWithMargin + data.finance.ordersWithoutMargin;
  const averageOrder = totalOrders > 0 ? data.finance.revenue / totalOrders : null;
  const totalExpenses = data.finance.directExpenses + data.finance.operatingExpenses + data.finance.payrollAccrued;
  const monthLabel = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Almaty" })
    .format(new Date(`${data.month}-15T12:00:00Z`));
  const outstanding = data.finance.customerOutstanding;
  const profitLabel = "Чистая прибыль";
  const activeEmployees = data.team.filter((employee) => employee.activeDays > 0).length;
  const completedTasks = data.team.reduce((sum, employee) => sum + employee.completedTasks, 0);
  const overdueTasks = data.team.reduce((sum, employee) => sum + employee.overdueTasks, 0);
  const attention = [
    data.orders.overdue > 0 ? `${data.orders.overdue} просроченных заказов` : null,
    data.orders.missingProductionPrice > 0 ? `${data.orders.missingProductionPrice} заказов без цены производства` : null,
    data.orders.incompleteData > 0 ? `${data.orders.incompleteData} заказов нужно дополнить` : null,
    data.finance.pendingOrderDates > 0 ? `${data.finance.pendingOrderDates} заказов ждут подтверждения фактической даты` : null,
    !data.marketing.spendTracked ? "расход Meta ещё не подключён" : null,
    data.marketing.leads === 0 ? "нет обращений в CRM за выбранный месяц" : null,
  ].filter((item): item is string => Boolean(item));
  const roleLabel: Record<string, string> = {
    OPERATIONS_DIRECTOR: "Директор",
    MARKETER: "Маркетолог",
    MANAGER: "Менеджер",
  };
  return (
    <>
      <section className="rounded-2xl border border-blue-500/25 bg-[#101827] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold text-white">Недельный отчёт собственника</h2><p className="text-sm text-slate-400">Сформирован автоматически за последние 7 дней · без ручного ввода</p></div><span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-200">{date(data.weekly.from)} — {date(data.weekly.to)}</span></div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <FounderEfficiency label="Продажи за неделю" value={money(data.weekly.revenue)} hint={`${data.weekly.orders} заказов по дате заказа`} tone="blue" />
          <FounderEfficiency label="Получено денег" value={money(data.weekly.received)} hint="Фактические поступления минус возвраты" tone="emerald" />
          <FounderEfficiency label="Обращения в CRM" value={String(data.weekly.leads)} hint="Новые заявки за 7 дней" href="/clients" tone="blue" />
          <FounderEfficiency label="Цена производства заполнена" value={`${data.weekly.ordersWithProductionPrice} / ${data.weekly.orders}`} hint="По новым заказам недели" tone={data.weekly.ordersWithProductionPrice < data.weekly.orders ? "amber" : "neutral"} />
        </div>
        <p className="mt-4 text-sm font-semibold text-white">Открытые вопросы директору сейчас</p>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <FounderEfficiency label="Просроченные заказы" value={String(data.weekly.overdueOrders)} hint="Открыть список заказов →" href="/orders?tab=active&attention=overdue" tone={data.weekly.overdueOrders ? "red" : "neutral"} />
          <FounderEfficiency label="Нужно дополнить" value={String(data.weekly.incompleteOrders)} hint="Открыть неполные карточки →" href="/orders?tab=active&attention=incomplete" tone={data.weekly.incompleteOrders ? "amber" : "neutral"} />
          <FounderEfficiency label="Просроченные задачи" value={String(data.weekly.overdueTeamTasks)} hint="Открыть просроченные задачи →" href="/calendar?state=overdue" tone={data.weekly.overdueTeamTasks ? "red" : "neutral"} />
        </div>
        <p className="mt-3 text-xs leading-5 text-slate-400">Эти три показателя показывают состояние на сейчас. В карточке «Контроль исполнения» видны конкретные замечания и ответственные.</p>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-bold text-white">Главная картина бизнеса</h2><p className="text-sm text-slate-400">Деньги и результат за {monthLabel}</p></div>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${attention.length ? "border-amber-500/30 bg-amber-500/10 text-amber-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>{attention.length ? `Требуют внимания: ${attention.length}` : "Всё под контролем"}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <FounderKpi label="Оборот компании" value={money(data.finance.revenue)} hint={`${totalOrders} заказов · средний чек ${averageOrder === null ? "—" : money(averageOrder)}`} tone="blue" />
          <FounderKpi label="Получено денег" value={money(data.finance.received)} hint={`По заказам месяца ${money(data.finance.receivedForPeriodOrders)} · открыть платежи`} tone="cyan" onClick={() => setDetailsOpen(detailsOpen === "cash" ? null : "cash")} />
          <FounderKpi label="Затраты и расходы месяца" value={money(totalExpenses)} hint="Цена производства заказов + расходы по датам + зарплата по ведомости · открыть состав" tone="amber" onClick={() => setDetailsOpen(detailsOpen === "costs" ? null : "costs")} />
          <FounderKpi label={profitLabel} value={data.finance.dataComplete ? money(data.finance.netProfit) : "Недостаточно данных"} hint={data.finance.dataComplete ? `Маржа ${percent(data.finance.netMargin)} · открыть расчёт` : "Открыть расчёт и заполнить цены производства"} tone={data.finance.dataComplete ? "emerald" : "amber"} onClick={() => setDetailsOpen(detailsOpen === "profit" ? null : "profit")} />
        </div>
        {detailsOpen && <FounderFinanceDetails data={data} view={detailsOpen} monthLabel={monthLabel} />}
        {attention.length ? <div className="mt-4 flex flex-wrap gap-2">{attention.map((item) => <span key={item} className="rounded-full bg-amber-500/10 px-3 py-1.5 text-xs text-amber-100">{item}</span>)}</div> : null}
      </section>

      <SalesPlanCard month={data.month} compact />

      <section className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <article className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-white">Доходы и расходы</h2><p className="text-sm text-slate-400">Итог выбранного месяца и текущие обязательства по активным заказам</p></div><Link href="/finance" className="text-sm font-semibold text-blue-300">Открыть финансы</Link></div>
          <div className="mt-4 overflow-hidden rounded-xl border border-slate-800">
            <table className="w-full text-sm"><tbody>
              <FounderFinanceRow label="Оборот по заказам" value={data.finance.revenue} />
              <FounderFinanceRow label="Поступило от клиентов" value={data.finance.received} onClick={() => revealDetails("cash")} />
              <FounderFinanceRow label="По заказам выбранного месяца" value={data.finance.receivedForPeriodOrders} />
              <FounderFinanceRow label="По заказам вне оборота месяца" value={data.finance.receivedFromOtherOrders} />
              <FounderFinanceRow label="Осталось получить по всем активным заказам" value={outstanding} warning={outstanding > 0} />
              <FounderFinanceRow label="Цена производства всех активных заказов" value={data.finance.activeProductionCost} />
              <FounderFinanceRow label="Прочие доходы" value={data.finance.additionalIncome} />
              <FounderFinanceRow label="Цена производства заказов месяца" value={data.finance.directExpenses} expense />
              <FounderFinanceRow label="Операционные расходы по дате операции" value={data.finance.operatingExpenses} expense />
              <FounderFinanceRow label="Зарплата по ведомости месяца" value={data.finance.payrollAccrued} expense />
              <FounderFinanceRow label="Затраты и расходы месяца" value={totalExpenses} expense strong onClick={() => revealDetails("costs")} />
              {data.finance.dataComplete ? <FounderFinanceRow label={profitLabel} value={data.finance.netProfit} strong profit onClick={() => revealDetails("profit")} /> : <tr className="border-t-2 border-slate-700"><td className="px-4 py-3">{profitLabel}</td><td className="px-4 py-3 text-right text-amber-200">Недостаточно данных</td></tr>}
            </tbody></table>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">Поступления считаются по дате платежа, оборот — по дате заказа. Поэтому деньги по старым заказам могут быть больше оборота этого месяца. Цена производства — затрата по заказам месяца, даже если фактическая выплата цеху была в другой день.</p>
          {data.finance.pendingOrderDates > 0 ? <p className="mt-3 text-xs leading-5 text-amber-200">Ещё {data.finance.pendingOrderDates} заказов не входят в отчёт месяца, пока менеджеры не подтвердят фактическую дату заказа.</p> : null}
          {!data.finance.dataComplete ? <p className="mt-3 text-xs leading-5 text-amber-200">Прибыль не рассчитана: цена производства заполнена по {data.finance.ordersWithMargin} из {totalOrders} заказов. Учтённые расходы показаны отдельно и не означают полноту данных.</p> : null}
        </article>

        <article className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-bold text-white">Процессы заказов</h2><p className="text-sm text-slate-400">Где сейчас находится работа</p></div><Link href="/orders" className="text-sm font-semibold text-blue-300">Все заказы</Link></div>
          <div className="mt-4 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
            <FounderProcessRow label="Активные заказы" value={data.orders.active} href="/orders?tab=active" />
            <FounderProcessRow label="До передачи в цех" value={data.orders.beforeWorkshop} href="/orders?tab=active&status=BEFORE_WORKSHOP" />
            <FounderProcessRow label="Передано и в работе" value={data.orders.transferredToWorkshop + data.orders.inWork} href="/orders?tab=active&status=IN_WORK" />
            <FounderProcessRow label="Готово и на монтаже" value={data.orders.readyForInstallation + data.orders.installation} href="/orders?tab=active&status=INSTALLATION" />
            <FounderProcessRow label="Просрочено" value={data.orders.overdue} href="/orders?tab=active&attention=overdue" warning={data.orders.overdue > 0} />
            <FounderProcessRow label="Нужно дополнить" value={data.orders.incompleteData} href="/orders?tab=active&attention=incomplete" warning={data.orders.incompleteData > 0} />
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Users size={20} className="text-blue-300"/><div><h2 className="text-lg font-bold text-white">Команда и рабочая активность</h2><p className="text-sm text-slate-400">Входы и реальные действия сотрудников в ORDA</p></div></div><Link href="/employees" className="text-sm font-semibold text-blue-300">Сотрудники</Link></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><FounderEfficiency label="Сотрудников" value={String(data.team.length)} hint="В контролируемой команде"/><FounderEfficiency label="Активны в месяце" value={`${activeEmployees} / ${data.team.length}`} hint="Есть входы в ORDA"/><FounderEfficiency label="Задач выполнено" value={String(completedTasks)} hint="Фактический результат"/><FounderEfficiency label="Просрочено задач" value={String(overdueTasks)} hint={overdueTasks ? "Нужно вмешательство" : "Просрочек нет"}/></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="text-left text-slate-400"><tr>{["Сотрудник", "Активных дней", "Заявки", "Заказы", "Продажи", "Выполнено", "Просрочено", "Последний вход"].map((label) => <th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{data.team.map((employee) => <tr key={employee.id} className="border-t border-slate-800"><td className="px-3 py-3"><b className="text-white">{employee.name}</b><span className="block text-xs text-slate-500">{roleLabel[employee.role] ?? employee.role}</span></td><td className="px-3">{employee.activeDays}</td><td className="px-3">{employee.leads}</td><td className="px-3">{employee.orders}</td><td className="px-3 tabular-nums text-emerald-200">{employee.role === "MANAGER" ? money(employee.sales) : "—"}</td><td className="px-3 text-emerald-300">{employee.completedTasks}</td><td className={employee.overdueTasks ? "px-3 font-semibold text-amber-300" : "px-3"}>{employee.overdueTasks}</td><td className="px-3 text-slate-400">{employee.lastLogin ? date(employee.lastLogin) : "Не входил"}</td></tr>)}</tbody></table></div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Megaphone size={20} className="text-fuchsia-300"/><div><h2 className="text-lg font-bold text-white">Маркетинг и продажи</h2><p className="text-sm text-slate-400">Расход, результат и стоимость привлечения</p></div></div><Link href="/marketing" className="text-sm font-semibold text-fuchsia-300">Открыть маркетинг</Link></div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <FounderEfficiency label="Расход рекламы" value={data.marketing.spendTracked ? money(data.marketing.spend) : "—"} hint={data.marketing.spendTracked ? "В аналитике маркетинга" : "Доступ Meta не подключён"}/>
          <FounderEfficiency label="Обращения" value={String(data.marketing.leads)} hint="Все новые заявки CRM"/>
          <FounderEfficiency label="Заказы" value={String(data.marketing.orders)} hint="По дате заказа за месяц"/>
          <FounderEfficiency label="Выручка" value={money(data.marketing.revenue)} hint="Продажи заказов месяца"/>
          <FounderEfficiency label="Цена обращения" value={data.marketing.cpl === null ? "—" : money(data.marketing.cpl)} hint={data.marketing.metaAttributionMissing ? "Нужна связь с рекламой" : "Расход / обращения"}/>
          <FounderEfficiency label="Цена заказа" value={data.marketing.cac === null ? "—" : money(data.marketing.cac)} hint={data.marketing.metaAttributionMissing ? "Нужна связь с рекламой" : "Расход / заказы"}/>
          <FounderEfficiency label="ROAS" value={data.marketing.roas === null ? "—" : `${data.marketing.roas.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}×`} hint={data.marketing.metaAttributionMissing ? "Нужна связь с рекламой" : "Выручка / расход"}/>
          <FounderEfficiency label="Конверсия" value={percent(data.marketing.conversion)} hint="Заказы / обращения"/>
        </div>
        {!data.marketing.spendTracked ? <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Обращения, заказы и выручка считаются из CRM. Расход появится после подключения служебного доступа Meta.</p> : data.marketing.metaAttributionMissing ? <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">Заявки CRM пока не связаны с кампаниями Meta. Стоимость привлечения и ROAS по всем источникам не рассчитываются.</p> : null}
      </section>

      <nav aria-label="Основные разделы собственника" className="flex flex-wrap gap-2">
        {[['/sales-plan', 'План продаж'], ['/reports', 'Все отчёты'], ['/finance', 'Финансы'], ['/employees', 'Сотрудники'], ['/settings', 'Настройки']].map(([href, label]) => <Link key={href} href={href} className="rounded-xl border border-slate-700 bg-[#101827] px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-blue-500/50 hover:text-white">{label}</Link>)}
      </nav>
    </>
  );
}

function FounderFinanceDetails({ data, view, monthLabel }: { data: ManagementPayload; view: "cash" | "costs" | "profit"; monthLabel: string }) {
  const finance = data.finance;
  return (
    <section id="founder-finance-details" className="mt-4 rounded-xl border border-slate-700 bg-slate-950/70 p-4">
      <h3 className="font-bold text-white">
        {view === "cash" ? "Поступления" : view === "costs" ? "Состав затрат и расходов" : "Расчёт чистой прибыли"} · {monthLabel}
      </h3>
      {view === "cash" ? (
        <>
          <p className="mt-2 text-sm text-slate-300">Платежи привязаны к месяцу по дате получения. Оборот учитывает заказы с подтверждённой датой выбранного месяца. Поэтому поступления по старым заказам или заказам без подтверждённой даты могут быть больше оборота.</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <MetricLine label="Все поступления" value={finance.received} />
            <MetricLine label="Заказы этого месяца" value={finance.receivedForPeriodOrders} />
            <MetricLine label="Заказы вне оборота месяца" value={finance.receivedFromOtherOrders} />
          </div>
          <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
            {finance.customerPayments.map((payment) => (
              <Link key={payment.id} href={payment.orderId ? `/orders/${payment.orderId}` : "/finance"} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800">
                <span>{date(payment.operationDate)} · {payment.orderNumber} <small className="block text-slate-400">Дата заказа: {date(payment.orderReceivedAt)} · {payment.fromPeriodOrder ? "в обороте месяца" : payment.orderDateNeedsReview ? "дата требует подтверждения" : "вне оборота месяца"}</small></span>
                <b className={payment.amount < 0 ? "text-red-300" : "text-emerald-300"}>{money(payment.amount)}</b>
              </Link>
            ))}
            {!finance.customerPayments.length && <p className="text-sm text-slate-400">Поступлений за этот месяц нет.</p>}
          </div>
        </>
      ) : (
        <>
          {view === "profit" && (
            <div className="mt-3 space-y-1 rounded-lg bg-slate-900 p-3 text-sm">
              <MetricLine label="Продажи с подтверждённой ценой производства" value={finance.pricedRevenue} />
              <MetricLine label="Прочие доходы месяца" value={finance.additionalIncome} />
              <MetricLine label="Цена производства заказов месяца" value={-finance.directExpenses} />
              <MetricLine label="Операционные расходы по дате операции" value={-finance.operatingExpenses} />
              <MetricLine label="Зарплата по ведомости месяца" value={-finance.payrollAccrued} />
              <MetricLine label={finance.dataComplete ? "Чистая прибыль" : "Промежуточный итог по заполненным заказам"} value={finance.netProfit} strong />
              {!finance.dataComplete && <p className="pt-2 text-amber-200">Расчёт неполный: {finance.ordersWithoutMargin} заказ(а) без подтверждённой цены производства.</p>}
            </div>
          )}
          <p className="mt-3 text-sm text-slate-300">Цена производства относится к заказам {monthLabel}, операционные расходы — к дате записи, зарплата совпадает с показателем «Начислено» в ведомости месяца. Пока ведомость открыта, зарплатная сумма может измениться. Расходы сентября не переносятся в октябрь автоматически.</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold text-white">Производство по заказам · {money(finance.directExpenses)}</h4>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {finance.productionCostOrders.map((order) => <Link key={order.id} href={`/orders/${order.id}`} className="flex justify-between rounded-lg bg-slate-900 px-3 py-2 text-sm hover:bg-slate-800"><span>{order.number}</span><b>{money(order.amount)}</b></Link>)}
                {!finance.productionCostOrders.length && <p className="text-sm text-slate-500">Заказов с подтверждённой ценой нет.</p>}
              </div>
            </div>
            <div>
              <h4 className="text-sm font-semibold text-white">Операционные расходы · {money(finance.operatingExpenses)}</h4>
              <div className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                {finance.operatingExpenseEntries.map((entry) => <div key={entry.id} className="flex justify-between gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm"><span>{date(entry.operationDate)} · {expenseLabel[entry.category] ?? entry.category}{entry.comment ? ` · ${entry.comment}` : ""}</span><b className="shrink-0">{money(entry.amount)}</b></div>)}
                {!finance.operatingExpenseEntries.length && <p className="text-sm text-slate-500">Операционных расходов за месяц нет.</p>}
              </div>
            </div>
          </div>
          <Link href="/payroll" className="mt-3 inline-block text-sm font-semibold text-blue-300">Зарплата по ведомости · {money(finance.payrollAccrued)} → открыть ведомость</Link>
        </>
      )}
    </section>
  );
}

function MetricLine({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  return <div className={`flex justify-between gap-3 py-1 ${strong ? "border-t border-slate-700 pt-2 font-bold text-white" : "text-slate-300"}`}><span>{label}</span><b className="shrink-0 tabular-nums">{money(value)}</b></div>;
}

function FounderKpi({ label, value, hint, tone, onClick }: { label: string; value: string; hint: string; tone: "blue" | "cyan" | "amber" | "emerald"; onClick?: () => void }) {
  const tones = { blue: "border-blue-500/25 bg-blue-500/5 text-blue-200", cyan: "border-cyan-500/25 bg-cyan-500/5 text-cyan-200", amber: "border-amber-500/25 bg-amber-500/5 text-amber-200", emerald: "border-emerald-500/25 bg-emerald-500/5 text-emerald-200" };
  const className = `rounded-xl border p-4 text-left ${tones[tone]} ${onClick ? "cursor-pointer hover:border-white/50" : ""}`;
  const content = <><p className="text-sm">{label}</p><p className="mt-2 break-words text-2xl font-bold text-white">{value}</p><p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p></>;
  return onClick ? <button type="button" onClick={onClick} className={className}>{content}</button> : <article className={className}>{content}</article>;
}

function FounderFinanceRow({ label, value, expense = false, warning = false, strong = false, profit = false, onClick }: { label: string; value: number; expense?: boolean; warning?: boolean; strong?: boolean; profit?: boolean; onClick?: () => void }) {
  return <tr className={strong ? "border-t-2 border-slate-700 bg-slate-900/70" : "border-t border-slate-800 first:border-0"}><td className={`px-4 py-3 ${strong ? "font-semibold text-white" : "text-slate-300"}`}>{onClick ? <button type="button" onClick={onClick} className="text-left underline decoration-dotted underline-offset-4 hover:text-blue-200">{label}</button> : label}</td><td className={`px-4 py-3 text-right tabular-nums ${profit ? value >= 0 ? "font-bold text-emerald-300" : "font-bold text-red-300" : warning ? "font-semibold text-amber-300" : expense ? "text-slate-200" : "font-semibold text-white"}`}>{expense && value > 0 ? "− " : ""}{money(value)}</td></tr>;
}

function FounderProcessRow({ label, value, href, warning = false }: { label: string; value: number; href: string; warning?: boolean }) {
  return <Link href={href} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-900"><span className="text-sm text-slate-300">{label}</span><span className={`text-lg font-bold tabular-nums ${warning ? "text-amber-300" : "text-white"}`}>{value}</span></Link>;
}

function FounderEfficiency({ label, value, hint, href, tone = "neutral" }: { label: string; value: string; hint: string; href?: string; tone?: "neutral" | "blue" | "emerald" | "amber" | "red" }) {
  const toneClasses = { neutral: "border-slate-800", blue: "border-blue-500/40", emerald: "border-emerald-500/40", amber: "border-amber-500/50", red: "border-red-500/50" };
  const valueClasses = { neutral: "text-white", blue: "text-blue-100", emerald: "text-emerald-100", amber: "text-amber-200", red: "text-red-200" };
  const className = `rounded-xl border bg-slate-950/45 p-4 ${toneClasses[tone]} ${href ? "block hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-blue-400" : ""}`;
  const content = <><p className="text-sm font-medium text-slate-300">{label}</p><p className={`mt-2 break-words text-2xl font-bold tabular-nums ${valueClasses[tone]}`}>{value}</p><p className="mt-1 text-xs leading-5 text-slate-400">{hint}</p></>;
  return href ? <Link href={href} className={className}>{content}</Link> : <article className={className}>{content}</article>;
}

function OperationsDashboard({ data }: { data: OperationsPayload }) {
  const cards = [
    ["Активные заказы", data.orders.active, "/orders?tab=active"],
    ["Просроченные", data.orders.overdue, "/orders?tab=active&attention=overdue"],
    ["Нужно дополнить", data.orders.incompleteData, "/orders?tab=active&attention=incomplete"],
    ["Передано в цех", data.orders.transferredToWorkshop + data.orders.inWork, "/orders?tab=active&status=IN_WORK"],
  ] as const;
  return <>
    <section>
      <div className="mb-3"><h2 className="text-xl font-bold text-white">Операционный контроль</h2><p className="text-sm text-slate-400">Система автоматически выделяет просрочки и незаполненные данные</p></div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {cards.map(([label, value, href]) => <Link key={label} href={href} className={`rounded-2xl border p-4 ${label === "Просроченные" && value > 0 ? "border-red-500/35 bg-red-500/10" : "border-slate-800 bg-[#101827]"}`}><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-3xl font-bold text-white">{value}</p></Link>)}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Link href="/clients" className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-semibold text-blue-200">Контролировать заявки</Link>
        <Link href="/measurements" className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-semibold text-blue-200">Контролировать замеры</Link>
        <Link href="/marketing" className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-semibold text-blue-200">Маркетинг</Link>
        <Link href="/vacancies" className="rounded-xl border border-slate-800 bg-slate-900 p-4 font-semibold text-blue-200">Вакансии и кандидаты</Link>
      </div>
    </section>
    <MarketingAndTeam data={data} />
    <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
      <div className="flex items-center gap-2"><AlertTriangle size={20} className="text-amber-300"/><div><h2 className="text-xl font-bold">Требуют внимания</h2><p className="text-sm text-slate-400">Без финансовых показателей и прибыли</p></div></div>
      <div className="mt-4 space-y-3">
        {data.attention.length ? data.attention.map((order) => <Link key={order.id} href={`/orders/${order.id}`} className="block rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-blue-500/50"><div className="flex flex-wrap items-center gap-2"><strong>{order.number}</strong><span className="rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-200">{USER_ORDER_STATUS_LABELS[order.status]}</span></div><p className="mt-1 text-sm text-slate-300">{order.client} · {order.responsible || "Ответственный не указан"} · срок {date(order.deadline)}</p><div className="mt-2 flex flex-wrap gap-2">{order.reasons.filter((reason) => !/цен.*производ|марж/i.test(reason)).map((reason) => <span key={reason} className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-200">{reason}</span>)}</div></Link>) : <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Заказов, требующих внимания, нет.</p>}
      </div>
    </section>
    <CalendarAgenda />
  </>;
}

function MarketingAndTeam({ data, founder = false }: { data: ManagementPayload | OperationsPayload; founder?: boolean }) {
  const roleLabel: Record<string, string> = {
    OPERATIONS_DIRECTOR: "Директор",
    MARKETER: "Маркетолог",
    MANAGER: "Менеджер",
  };
  return <>
    <section className="rounded-2xl border border-fuchsia-500/20 bg-[#101827] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="flex items-center gap-2"><Megaphone size={20} className="text-fuchsia-300"/><div><h2 className="text-xl font-bold">Маркетинг и CRM</h2><p className="text-sm text-slate-400">Расход рекламы и обращения выбранного месяца</p></div></div><Link href="/marketing" className="rounded-xl border border-fuchsia-500/30 px-3 py-2 text-sm font-semibold text-fuchsia-200">Открыть маркетинг</Link></div>
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        <FounderEfficiency label="Расход" value={data.marketing.spendTracked ? money(data.marketing.spend) : "—"} hint="В аналитике маркетинга" />
        <FounderEfficiency label="Обращения" value={String(data.marketing.leads)} hint="Все новые заявки CRM" />
        <FounderEfficiency label="Заказы" value={String(data.marketing.orders)} hint="По дате заказа за месяц" />
        <FounderEfficiency label="Выручка" value={money(data.marketing.revenue)} hint="Продажи заказов месяца" />
        <FounderEfficiency label="Цена лида" value={data.marketing.cpl === null ? "—" : money(data.marketing.cpl)} hint="Расход / лиды" />
        <FounderEfficiency label="Цена клиента" value={data.marketing.cac === null ? "—" : money(data.marketing.cac)} hint="Расход / заказы" />
        <FounderEfficiency label="Конверсия" value={percent(data.marketing.qualifiedShare)} hint="Лид → заказ" />
        <FounderEfficiency label="ROAS" value={data.marketing.roas === null ? "—" : `${data.marketing.roas.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}×`} hint="Выручка / расход" />
      </div>
      {!data.marketing.spendTracked && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">Расход Meta за этот месяц ещё не синхронизирован. Проверьте статус подключения в маркетинге.</p>}
      {data.marketing.metaAttributionMissing && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">Обращения и заказы CRM пока не связаны с кампаниями Meta; цена привлечения и ROAS не рассчитываются по всем источникам.</p>}
      <div className="mt-4 rounded-xl bg-slate-950/60 p-4 text-sm text-slate-300"><b className="text-white">3D после КП:</b> сделано {data.salesTools.designDone}, не использовано {data.salesTools.designSkipped}, заказов после 3D {data.salesTools.designConverted}. Фактическая конверсия: {percent(data.salesTools.designConversion)}.</div>
    </section>
    <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
      <div className="flex items-center gap-2"><Users size={20} className="text-blue-300"/><div><h2 className="text-xl font-bold">Рабочая активность команды</h2><p className="text-sm text-slate-400">Только проверяемые действия в ORDA — без придуманной оценки</p></div></div>
      <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead className="text-left text-slate-400"><tr>{["Сотрудник", "Дней входа", "Заявки", "Заказы", "Продажи", "Задач выполнено", "Просрочено", "Последний вход"].map((label)=><th key={label} className="px-3 py-2">{label}</th>)}</tr></thead><tbody>{data.team.map((item)=><tr key={item.id} className="border-t border-slate-800"><td className="px-3 py-3"><b className="text-white">{item.name}</b><span className="block text-xs text-slate-500">{roleLabel[item.role] ?? item.role}</span></td><td className="px-3">{item.activeDays}</td><td className="px-3">{item.leads}</td><td className="px-3">{item.orders}</td><td className="px-3 tabular-nums text-emerald-200">{item.role === "MANAGER" ? money(item.sales) : "—"}</td><td className="px-3 text-emerald-300">{item.completedTasks}</td><td className={item.overdueTasks ? "px-3 font-semibold text-amber-300" : "px-3"}>{item.overdueTasks}</td><td className="px-3 text-slate-400">{item.lastLogin ? date(item.lastLogin) : "Не входил"}</td></tr>)}</tbody></table></div>
      {founder && <p className="mt-3 text-xs text-slate-500">Входы показывают интерес к работе только как факт активности. Штрафы не начисляются автоматически: решение всегда принимает основатель.</p>}
    </section>
  </>;
}

function ManagementDashboard({
  data,
  historyOpen,
  onHistory,
  onAddEntry,
}: {
  data: ManagementPayload;
  historyOpen: boolean;
  onHistory: () => void;
  onAddEntry: (direction: "INCOME" | "EXPENSE") => void;
}) {
  const finance = [
    ["Выручка", money(data.finance.revenue), "Все продажи месяца"],
    ["Получено от клиентов", money(data.finance.received), "Платежи минус возвраты"],
    ["Цена производства", money(data.finance.directExpenses), "По заказам с обеими суммами"],
    ["Прочие доходы", money(data.finance.additionalIncome), "Внесены директором"],
    ["Операционные расходы", money(data.finance.operatingExpenses), "Расходы компании вне заказов"],
    ["Начисленная зарплата", money(data.finance.payrollAccrued), "Расход месяца"],
    ["Выплаченная зарплата", money(data.finance.payrollPaid), "Фактические выплаты"],
    [
      "Чистая прибыль",
      data.finance.dataComplete ? money(data.finance.netProfit) : "Недостаточно данных",
      "Маржа заказов + доходы − расходы − зарплата",
    ],
    [
      "Чистая маржа",
      !data.finance.dataComplete || data.finance.netMargin === null
        ? "Недостаточно данных"
        : `${data.finance.netMargin.toLocaleString("ru-RU")} %`,
      "Чистая прибыль / продажи с обеими суммами",
    ],
  ];
  const orders = [
    ["Активные", data.orders.active, "/orders?tab=active"],
    ["До цеха", data.orders.beforeWorkshop, "/orders?tab=active&status=BEFORE_WORKSHOP"],
    ["Передано в цех", data.orders.transferredToWorkshop, "/orders?tab=active&status=TRANSFERRED_TO_WORKSHOP"],
    ["В работе", data.orders.inWork, "/orders?tab=active&status=IN_WORK"],
    ["Готово к монтажу", data.orders.readyForInstallation, "/orders?tab=active&status=READY_FOR_INSTALLATION"],
    ["На монтаже", data.orders.installation, "/orders?tab=active&status=INSTALLATION"],
    ["Просрочено", data.orders.overdue, "/orders?tab=active&attention=overdue"],
    ["Без цены производства", data.orders.missingProductionPrice, "/orders?tab=active&attention=missing-production-price"],
    ["Нужно дополнить", data.orders.incompleteData, "/orders?tab=active&attention=incomplete"],
  ] as const;
  return (
    <>
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Финансовый результат</h2>
            <p className="text-sm text-slate-400">За выбранный месяц</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onHistory}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold sm:flex-none"
            >
              <ReceiptText size={17} /> История расходов
            </button>
            <button
              type="button"
              onClick={() => onAddEntry("INCOME")}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 text-sm font-semibold sm:flex-none"
            >
              <Plus size={17} /> Добавить доход
            </button>
            <button
              type="button"
              onClick={() => onAddEntry("EXPENSE")}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold sm:flex-none"
            >
              <Plus size={17} /> Добавить расход
            </button>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {finance.map(([label, value, hint], index) => (
            <article
              key={label}
              className={`rounded-2xl border p-4 ${index >= 6 ? "border-emerald-500/25 bg-emerald-500/5" : "border-slate-800 bg-[#101827]"}`}
            >
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-2 break-words text-xl font-bold text-white">{value}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
            </article>
          ))}
        </div>
        <p className="mt-3 rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-sm text-blue-100">
          Прибыль рассчитана по {data.finance.ordersWithMargin} заказам с суммой продажи и ценой производства.
          {data.finance.ordersWithoutMargin > 0
            ? ` Ещё ${data.finance.ordersWithoutMargin} заказов ждут заполнения и не искажают итог.`
            : " Все заказы месяца заполнены."}
        </p>
        {!data.finance.dataComplete && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Заполните цену производства в отмеченных заказах, чтобы они вошли в прибыль месяца.
          </p>
        )}
      </section>

      {historyOpen && (
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
          <h2 className="font-bold text-white">Расходы месяца</h2>
          <div className="mt-3 space-y-2">
            {data.expenses.length ? (
              data.expenses.map((entry) => (
                <div
                  key={entry.id}
                  className="grid gap-1 rounded-xl bg-slate-950/60 p-3 text-sm sm:grid-cols-[140px_1fr_auto] sm:items-center"
                >
                  <span className="text-slate-400">{date(entry.operationDate)}</span>
                  <span className="min-w-0 break-words text-slate-200">
                    {expenseLabel[entry.category] ?? entry.category}
                    {entry.orderNumber ? ` · заказ ${entry.orderNumber}` : ""}
                    {entry.comment ? ` · ${entry.comment}` : ""}
                  </span>
                  <strong className="text-white">{money(entry.amount)}</strong>
                </div>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
                Расходов за месяц нет.
              </p>
            )}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-xl font-bold text-white">Заказы</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-9">
          {orders.map(([label, value, href]) => (
            <Link
              key={label}
              href={href}
              className={`rounded-2xl border p-4 transition hover:border-blue-500/50 ${label === "Просрочено" && value > 0 ? "border-red-500/30 bg-red-500/5" : "border-slate-800 bg-[#101827]"}`}
            >
              <p className="text-sm text-slate-400">{label}</p>
              <p className="mt-2 text-2xl font-bold text-white">{value}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} className="text-amber-300" />
          <h2 className="text-xl font-bold text-white">Требуют внимания</h2>
        </div>
        <div className="mt-4 space-y-3">
          {data.attention.length ? (
            data.attention.map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="grid min-w-0 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 transition hover:border-blue-500/50 md:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-white">{order.number}</strong>
                    <span className="rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                      {USER_ORDER_STATUS_LABELS[order.status]}
                    </span>
                  </div>
                  <p className="mt-1 break-words text-sm text-slate-300">
                    {order.client} · {order.responsible || "Ответственный не указан"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {order.reasons.map((reason) => (
                      <span
                        key={reason}
                        className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-200"
                      >
                        {reason}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="text-sm md:text-right">
                  <p className="text-slate-400">Срок: {date(order.deadline)}</p>
                  <p className="mt-1 font-semibold text-white">
                    {order.netProfit === null ? "Прибыль: нет данных" : `Прибыль: ${money(order.netProfit)}`}
                  </p>
                </div>
              </Link>
            ))
          ) : (
            <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              Заказов, требующих внимания, нет.
            </p>
          )}
        </div>
      </section>
    </>
  );
}

function ManagerDashboard({ data }: { data: ManagerPayload }) {
  const duePayments = data.paymentFollowUps ?? [];
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SimpleCard icon={<ClipboardList />} label="Мои активные заказы" value={String(data.orders.active)} href="/orders" />
      <SimpleCard icon={<AlertTriangle />} label="Просрочено" value={String(data.orders.overdue)} href="/orders?attention=overdue" />
      <SimpleCard icon={<Factory />} label="Без цены производства" value={String(data.orders.missingProductionPrice)} href="/orders?attention=missing-production-price" />
      <SimpleCard icon={<ClipboardList />} label="Нужно дополнить" value={String(data.orders.incompleteData)} href="/orders" />
      <div className="sm:col-span-2 xl:col-span-4 rounded-2xl border border-blue-500/25 bg-[#101827] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-white">Обещанные доплаты клиентов</h2><p className="mt-1 text-sm text-slate-400">ORDA напомнит в срок и потребует зафиксировать результат.</p></div><span className="rounded-full bg-blue-500/15 px-3 py-1 text-sm text-blue-200">Активно: {duePayments.length}</span></div>
        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {duePayments.map((item) => item.order ? <Link key={item.id} href={`/orders/${item.order.id}`} className={`rounded-xl border p-3 ${item.overdue ? "border-red-500/40 bg-red-500/5" : "border-slate-800 bg-slate-950"}`}>
            <div className="flex items-start justify-between gap-3"><div><b>{item.order.number}</b><p className="text-sm text-slate-400">{item.order.client.name}</p></div><span className={`text-sm font-semibold ${item.overdue ? "text-red-300" : "text-blue-300"}`}>{Number(item.expectedAmount ?? 0).toLocaleString("ru-RU")} ₸</span></div>
            <p className="mt-2 text-xs text-slate-500">{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.dueAt))} · {item.overdue ? "просрочено" : item.acknowledgedAt ? "ознакомлен" : "ожидает срока"}</p>
          </Link> : null)}
          {!duePayments.length ? <p className="rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500 lg:col-span-2">Нет активных обещаний по доплате.</p> : null}
        </div>
      </div>
      <div className="sm:col-span-2 xl:col-span-4 rounded-2xl border border-slate-800 bg-[#101827] p-5">
        <h2 className="font-bold">Что нужно дополнить по заказам</h2>
        <div className="mt-3 space-y-2">
          {data.attention.map((order) => (
            <Link key={order.id} href={`/orders/${order.id}`} className="block rounded-xl bg-slate-950 p-3">
              <b>{order.number}</b> · {order.client} · {USER_ORDER_STATUS_LABELS[order.status]}
              {order.missingFields.length ? (
                <span className="mt-2 block text-sm text-amber-300">{order.missingFields.join(" · ")}</span>
              ) : <span className="mt-2 block text-sm text-slate-400">Есть неоплаченный остаток</span>}
            </Link>
          ))}
          {!data.attention.length ? <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-slate-400">Все обязательные данные заполнены.</p> : null}
        </div>
      </div>
    </section>
  );
}

function DailyCrmPanel({ data, managerView = false }: { data: DailyCrmPayload; managerView?: boolean }) {
  const statusLabel = (status: DailyCrmPayload["managers"][number]["reportStatus"]) => status === "SENT" ? "Отправлен" : status === "ACKNOWLEDGED" ? "Ознакомлен" : "Ждёт отчёта";
  const statusTone = (status: DailyCrmPayload["managers"][number]["reportStatus"]) => status === "SENT" ? "text-emerald-300" : status === "ACKNOWLEDGED" ? "text-blue-300" : "text-amber-300";
  return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-cyan-300">Ежедневный CRM-контроль</p><h2 className="mt-1 text-xl font-bold text-white">Результат за {data.dateLabel}</h2><p className="mt-1 text-sm text-slate-400">Цифры собраны из заявок, контактов, замеров и заказов ORDA. Менеджер подтверждает результат отдельной задачей.</p></div><Link href="/clients" className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-blue-200">Открыть заявки</Link></div>
    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      <DailyMetric label="Новые заявки" value={data.totals.leadsReceived}/><DailyMetric label="Есть контакт" value={data.totals.contacted}/><DailyMetric label="Заинтересованы" value={data.totals.interested}/><DailyMetric label="Замеры назначены" value={data.totals.measurementsScheduled}/><DailyMetric label="Замеры завершены" value={data.totals.measurementsCompleted}/><DailyMetric label="Заказы" value={data.totals.ordersCreated}/><DailyMetric label="Продажи" value={money(data.totals.revenue)}/>
    </div>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[820px] text-sm"><thead className="text-left text-slate-500"><tr>{["Менеджер", "Заявки", "Контакт", "Интерес", "Замеры", "Заказы", "Продажи", "Отчёт"].map((label) => <th key={label} className="px-3 py-2 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-800">{data.managers.map((row) => <tr key={row.managerId}><td className="px-3 py-3 font-semibold text-white">{row.manager}</td><td className="px-3 py-3">{row.leadsReceived}</td><td className="px-3 py-3">{row.contacted}</td><td className="px-3 py-3">{row.interested}</td><td className="px-3 py-3">{row.measurementsScheduled} / {row.measurementsCompleted}</td><td className="px-3 py-3">{row.ordersCreated}</td><td className="px-3 py-3">{money(row.revenue)}</td><td className={`px-3 py-3 font-semibold ${statusTone(row.reportStatus)}`}>{statusLabel(row.reportStatus)}</td></tr>)}</tbody></table></div>
    {!data.managers.length ? <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-5 text-sm text-slate-500">Активных менеджеров нет.</p> : null}
    {managerView && data.managers.some((row) => row.reportStatus !== "SENT") ? <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-100">В 10:00 откроется обязательная задача: проверьте карточки за вчера, подтвердите ознакомление и отправьте короткий результат.</p> : null}
  </section>;
}

function DailyMetric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-bold text-white">{value}</p></div>;
}

function ProductionDashboard({ data }: { data: ProductionPayload }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5">
      <h2 className="flex items-center gap-2 text-xl font-bold"><Factory /> Исполнение заказов</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {data.jobs.map((job) => (
          <Link key={job.id} href={job.href} className="rounded-xl bg-slate-950 p-4">
            <b>{job.order.number}</b><p className="text-sm text-slate-400">{job.order.client.name} · {USER_ORDER_STATUS_LABELS[job.status]}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function InstallerDashboard({ data }: { data: InstallerPayload }) {
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5">
      <h2 className="flex items-center gap-2 text-xl font-bold"><CalendarDays /> Монтажи</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {data.installations.map((item) => (
          <Link key={item.id} href={item.href} className="rounded-xl bg-slate-950 p-4">
            <b>{item.order.number}</b><p className="text-sm text-slate-400">{item.order.client.name} · {date(item.scheduledAt)}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function SimpleCard({ icon, label, value, href }: { icon: React.ReactNode; label: string; value: string; href: string }) {
  return <Link href={href} className="rounded-2xl border border-slate-800 bg-[#101827] p-5"><span className="text-blue-300">{icon}</span><p className="mt-3 text-sm text-slate-400">{label}</p><p className="mt-1 text-3xl font-bold">{value}</p></Link>;
}

function DashboardSkeleton() {
  return <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-2xl bg-slate-900" />)}</div>;
}

function FinanceEntryDialog({ direction, onClose, onSaved }: { direction: "INCOME" | "EXPENSE"; onClose: () => void; onSaved: () => Promise<void> }) {
  const income = direction === "INCOME";
  const categories = income ? incomeCategories : expenseCategories;
  const [form, setForm] = useState<{ amount: string; category: string; operationDate: string; comment: string; orderId: string }>({ amount: "", category: categories[0][0], operationDate: today(), comment: "", orderId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/company-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ direction, type: income ? "MANUAL_INCOME" : "MANUAL_EXPENSE", category: form.category, amount: Number(form.amount), operationDate: form.operationDate, comment: form.comment, orderId: form.orderId ? Number(form.orderId) : undefined }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Не удалось добавить ${income ? "доход" : "расход"}`);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Не удалось добавить ${income ? "доход" : "расход"}`);
    } finally { setSaving(false); }
  }
  const control = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white";
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-[90] grid place-items-end bg-black/70 sm:place-items-center sm:p-4">
    <form onSubmit={submit} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:max-w-lg sm:rounded-2xl">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Добавить {income ? "доход" : "расход"}</h2><p className="text-sm text-slate-400">{income ? "Дополнительный доход компании" : "Начисленный расход компании"}</p></div><button type="button" onClick={onClose} aria-label="Закрыть" className="grid size-11 place-items-center rounded-xl border border-slate-700"><X /></button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-300">Сумма<input required autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={control} /></label>
        <label className="text-sm text-slate-300">Категория<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={control}>{categories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm text-slate-300">Дата<input required type="date" value={form.operationDate} onChange={(e) => setForm({ ...form, operationDate: e.target.value })} className={control} /></label>
        <label className="text-sm text-slate-300">ID заказа <span className="text-slate-500">(необязательно)</span><input type="number" min="1" inputMode="numeric" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })} className={control} /></label>
        <label className="text-sm text-slate-300 sm:col-span-2">Комментарий<textarea rows={3} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} className={`${control} py-3`} /></label>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-slate-300">Отмена</button><button disabled={saving} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 font-semibold disabled:opacity-50 ${income ? "bg-emerald-700" : "bg-blue-600"}`}><Banknote size={17}/>{saving ? "Сохранение…" : `Добавить ${income ? "доход" : "расход"}`}</button></div>
    </form>
  </div>;
}
