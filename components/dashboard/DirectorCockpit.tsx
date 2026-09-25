"use client";

import {
  AlertTriangle,
  Banknote,
  CalendarDays,
  ClipboardList,
  Factory,
  Plus,
  RefreshCw,
  ReceiptText,
  X,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  USER_ORDER_STATUS_LABELS,
  type UserOrderStatus,
} from "@/lib/orders/presentation";

type ManagementPayload = {
  role: "DIRECTOR" | "ACCOUNTANT";
  month: string;
  finance: {
    revenue: number;
    received: number;
    directExpenses: number;
    operatingExpenses: number;
    payrollAccrued: number;
    payrollPaid: number;
    netProfit: number | null;
    netMargin: number | null;
    dataComplete: boolean;
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
const expenseLabel = Object.fromEntries(expenseCategories);
const money = (value: number) =>
  `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);
const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Без срока";

export default function DirectorCockpit() {
  const { data: session } = useSession();
  const [month, setMonth] = useState(currentMonth);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expenseOpen, setExpenseOpen] = useState(false);
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
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-[#101827] p-5 sm:p-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.22em] text-amber-300">
            ORDA · ALTYN SAPA
          </p>
          <h1 className="mt-2 text-3xl font-bold text-white">Главная</h1>
          <p className="mt-1 text-sm text-slate-400">
            Деньги компании и состояние заказов — без лишних модулей.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {(session?.user.role === "DIRECTOR" ||
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
      {data?.role === "DIRECTOR" || data?.role === "ACCOUNTANT" ? (
        <ManagementDashboard
          data={data}
          historyOpen={historyOpen}
          onHistory={() => setHistoryOpen((value) => !value)}
          onAddExpense={() => setExpenseOpen(true)}
        />
      ) : null}
      {data?.role === "MANAGER" ? <ManagerDashboard data={data} /> : null}
      {data?.role === "PRODUCTION" ? <ProductionDashboard data={data} /> : null}
      {data?.role === "INSTALLER" ? <InstallerDashboard data={data} /> : null}

      {expenseOpen && (
        <ExpenseDialog
          onClose={() => setExpenseOpen(false)}
          onSaved={async () => {
            setExpenseOpen(false);
            await load();
          }}
        />
      )}
    </main>
  );
}

function ManagementDashboard({
  data,
  historyOpen,
  onHistory,
  onAddExpense,
}: {
  data: ManagementPayload;
  historyOpen: boolean;
  onHistory: () => void;
  onAddExpense: () => void;
}) {
  const finance = [
    ["Выручка", money(data.finance.revenue), "Продажи действующих заказов месяца"],
    ["Получено от клиентов", money(data.finance.received), "Платежи минус возвраты"],
    ["Прямые расходы", money(data.finance.directExpenses), "Себестоимость заказов"],
    ["Операционные расходы", money(data.finance.operatingExpenses), "Расходы компании вне заказов"],
    ["Начисленная зарплата", money(data.finance.payrollAccrued), "Расход месяца"],
    ["Выплаченная зарплата", money(data.finance.payrollPaid), "Фактические выплаты"],
    [
      "Чистая прибыль",
      data.finance.netProfit === null
        ? "Недостаточно данных"
        : money(data.finance.netProfit),
      "Выручка − расходы − начисленная зарплата",
    ],
    [
      "Чистая маржа",
      data.finance.netMargin === null
        ? "Недостаточно данных"
        : `${data.finance.netMargin.toLocaleString("ru-RU")} %`,
      "Чистая прибыль / выручка",
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
    ["Нужно дополнить", data.orders.incompleteData, "/orders?tab=active"],
  ] as const;
  return (
    <>
      <section>
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">Финансовый результат</h2>
            <p className="text-sm text-slate-400">За выбранный месяц</p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onHistory}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold sm:flex-none"
            >
              <ReceiptText size={17} /> История расходов
            </button>
            <button
              type="button"
              onClick={onAddExpense}
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
        {!data.finance.dataComplete && (
          <p className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Чистая прибыль не показана: у части заказов месяца не заполнена стоимость подрядчика или производства.
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
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SimpleCard icon={<ClipboardList />} label="Мои активные заказы" value={String(data.orders.active)} href="/orders" />
      <SimpleCard icon={<AlertTriangle />} label="Просрочено" value={String(data.orders.overdue)} href="/orders?attention=overdue" />
      <SimpleCard icon={<Factory />} label="Без цены производства" value={String(data.orders.missingProductionPrice)} href="/orders?attention=missing-production-price" />
      <SimpleCard icon={<ClipboardList />} label="Нужно дополнить" value={String(data.orders.incompleteData)} href="/orders" />
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

function ExpenseDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ amount: "", category: "OTHER", operationDate: today(), comment: "", orderId: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/company-finance", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ direction: "EXPENSE", type: "MANUAL_EXPENSE", category: form.category, amount: Number(form.amount), operationDate: form.operationDate, comment: form.comment, orderId: form.orderId ? Number(form.orderId) : undefined }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось добавить расход");
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось добавить расход");
    } finally { setSaving(false); }
  }
  const control = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white";
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-[90] grid place-items-end bg-black/70 sm:place-items-center sm:p-4">
    <form onSubmit={submit} className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:max-w-lg sm:rounded-2xl">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold">Добавить расход</h2><p className="text-sm text-slate-400">Начисленный расход компании</p></div><button type="button" onClick={onClose} aria-label="Закрыть" className="grid size-11 place-items-center rounded-xl border border-slate-700"><X /></button></div>
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-slate-300">Сумма<input required autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} className={control} /></label>
        <label className="text-sm text-slate-300">Категория<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={control}>{expenseCategories.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm text-slate-300">Дата<input required type="date" value={form.operationDate} onChange={(e) => setForm({ ...form, operationDate: e.target.value })} className={control} /></label>
        <label className="text-sm text-slate-300">ID заказа <span className="text-slate-500">(необязательно)</span><input type="number" min="1" inputMode="numeric" value={form.orderId} onChange={(e) => setForm({ ...form, orderId: e.target.value })} className={control} /></label>
        <label className="text-sm text-slate-300 sm:col-span-2">Комментарий<textarea rows={3} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} className={`${control} py-3`} /></label>
      </div>
      {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={onClose} className="min-h-11 rounded-xl px-4 text-slate-300">Отмена</button><button disabled={saving} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold disabled:opacity-50"><Banknote size={17}/>{saving ? "Сохранение…" : "Добавить расход"}</button></div>
    </form>
  </div>;
}
