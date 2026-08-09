"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

type Operation = {
  id: string;
  type: string;
  amount: number;
  direction: "INCOME" | "EXPENSE";
  method: string;
  comment: string | null;
  author: string | null;
  operationDate: string;
  order: { id: number; number: string; client: { name: string } } | null;
  partner: { name: string } | null;
  employee: string | null;
};
type Data = {
  rows: { id: number; number: string; client: string }[];
  partners: { id: number; name: string }[];
  operations: Operation[];
  operationTotals: { income: number; expense: number; net: number };
  cards: { receipts: number; expenses: number; customerReceivable: number; partnerPayable: number; payrollPayable: number; grossMargin: number };
  trend: Array<{ date: string; income: number; expense: number }>;
  partnerTotals: { agreed: number; paid: number; remaining: number };
  partnerBreakdown: Array<{ partnerId: number; partner: string; orders: number; agreed: number; paid: number; remaining: number }>;
  alerts: { withoutPartner: number; withoutPartnerPrice: number; overdueCustomer: number; overduePartner: number };
};

const empty: Data = {
  rows: [],
  partners: [],
  operations: [],
  operationTotals: { income: 0, expense: 0, net: 0 },
  cards: { receipts: 0, expenses: 0, customerReceivable: 0, partnerPayable: 0, payrollPayable: 0, grossMargin: 0 },
  trend: [],
  partnerTotals: { agreed: 0, paid: 0, remaining: 0 },
  partnerBreakdown: [],
  alerts: { withoutPartner: 0, withoutPartnerPrice: 0, overdueCustomer: 0, overduePartner: 0 },
};
const operationLabels: Record<string, string> = {
  CLIENT_PAYMENT: "Оплата клиента",
  REFUND: "Возврат клиенту",
  EXPENSE: "Расход",
  OTHER_INCOME: "Прочее поступление",
  PARTNER_PAYOUT: "Выплата цеху",
  PAYROLL_PAYMENT: "Выплата сотруднику",
  OTHER_EXPENSE: "Прочий расход",
  ADJUSTMENT: "Корректировка",
};
const methodLabels: Record<string, string> = {
  cash: "Наличные",
  kaspi: "Kaspi",
  bank_transfer: "Банковский перевод",
  card: "Карта",
  other: "Другое",
};
const createOperationOptions = Object.entries(operationLabels).filter(
  ([type]) => !["EXPENSE", "PARTNER_PAYOUT", "PAYROLL_PAYMENT", "OTHER_EXPENSE"].includes(type),
);
const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 2,
  }).format(value);
const localDateTime = (date: Date) => {
  const offset = date.getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
};
const localDate = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

export default function FinancePage() {
  const { data: session } = useSession();
  const [data, setData] = useState<Data>(empty);
  const [period, setPeriod] = useState("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [direction, setDirection] = useState("all");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [operation, setOperation] = useState({
    type: "OTHER_INCOME",
    amount: "",
    method: "cash",
    orderId: "",
    partnerId: "",
    comment: "",
    operationDate: localDate(),
    adjustmentDirection: "INCOME",
  });
  const { getKey, reset } = useIdempotencyKey();
  const canCreate = session?.user.role === "DIRECTOR" || session?.user.role === "ACCOUNTANT";

  useEffect(() => {
    const timer = window.setTimeout(
      () => setDebouncedSearch(search.trim().toLocaleLowerCase("ru")),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const now = new Date();
      const from = new Date(now);
      const to = new Date(now);
      from.setHours(0, 0, 0, 0);
      to.setHours(23, 59, 59, 999);
      if (period === "week") from.setDate(from.getDate() - 6);
      if (period === "month") from.setDate(1);
      if (period === "quarter") from.setMonth(Math.floor(from.getMonth() / 3) * 3, 1);
      if (period === "year") from.setMonth(0, 1);
      if (period === "custom") {
        if (!customFrom || !customTo) {
          setLoading(false);
          return;
        }
        const [fy, fm, fd] = customFrom.split("-").map(Number);
        const [ty, tm, td] = customTo.split("-").map(Number);
        from.setFullYear(fy, fm - 1, fd);
        from.setHours(0, 0, 0, 0);
        to.setFullYear(ty, tm - 1, td);
        to.setHours(23, 59, 59, 999);
      }
      const params = new URLSearchParams({
        period,
        from: localDateTime(from),
        to: localDateTime(to),
      });
      const response = await fetch(`/api/finance?${params}`, {
        cache: "no-store",
      });
      const result = (await response.json()) as Data & { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось загрузить финансы");
      setData(result);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить финансы",
      );
    } finally {
      setLoading(false);
    }
  }, [customFrom, customTo, period]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getKey(),
        },
        body: JSON.stringify({
          ...operation,
          orderId: operation.orderId || undefined,
          partnerId: operation.partnerId || undefined,
        }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(result.error ?? "Не удалось сохранить операцию");
      reset();
      setOperation((item) => ({ ...item, amount: "", comment: "" }));
      setOpen(false);
      setSuccess("Операция сохранена, показатели обновлены.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сохранить операцию",
      );
    } finally {
      setSaving(false);
    }
  }

  const visible = useMemo(
    () =>
      data.operations.filter((item) => {
        const outgoing = item.direction === "EXPENSE";
        if (direction === "income" && outgoing) return false;
        if (direction === "expense" && !outgoing) return false;
        if (category && item.type !== category) return false;
        if (!debouncedSearch) return true;
        return [
          operationLabels[item.type],
          item.comment,
          item.order?.number,
          item.order?.client.name,
          item.partner?.name,
          item.employee,
          item.author,
        ].some((value) =>
          value?.toLocaleLowerCase("ru").includes(debouncedSearch),
        );
      }),
    [category, data.operations, debouncedSearch, direction],
  );

  const set = (key: keyof typeof operation, value: string) =>
    setOperation((item) => ({ ...item, [key]: value }));
  return (
    <section className="space-y-6 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">Финансы</h1>
          <p className="mt-1 text-sm text-slate-400 sm:text-base">
            Движение денег за выбранный период
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => {
              setOpen((value) => !value);
              setSuccess("");
            }}
            className="min-h-11 w-full rounded-xl bg-blue-600 px-5 py-3 font-medium text-white hover:bg-blue-500 sm:w-auto"
          >
            {open ? "Закрыть" : "Добавить операцию"}
          </button>
        )}
      </header>
      <div className="flex flex-wrap gap-2" aria-label="Период">
        {[
          ["today", "Сегодня"],
          ["week", "Неделя"],
          ["month", "Месяц"],
          ["quarter", "Квартал"],
          ["year", "Год"],
          ["custom", "Произвольный период"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => setPeriod(value)}
            className={`min-h-10 rounded-xl px-4 text-sm ${period === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:grid-cols-2">
          <Field label="С даты">
            <input
              type="date"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="По дату">
            <input
              type="date"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => setCustomTo(e.target.value)}
              className="input"
            />
          </Field>
        </div>
      )}
      {open && (
        <form
          onSubmit={submit}
          className="grid gap-4 rounded-2xl border border-blue-800/60 bg-[#101827] p-4 sm:p-5 md:grid-cols-2 xl:grid-cols-4"
        >
          <Field label="Категория операции">
            <Select
              value={operation.type}
              onChange={(v) => set("type", v)}
              options={createOperationOptions}
            />
          </Field>
          <Field label="Сумма">
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              value={operation.amount}
              onChange={(e) => set("amount", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Способ оплаты">
            <Select
              value={operation.method}
              onChange={(v) => set("method", v)}
              options={Object.entries(methodLabels)}
            />
          </Field>
          <Field label="Дата">
            <input
              required
              type="date"
              value={operation.operationDate}
              onChange={(e) => set("operationDate", e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Заказ">
            <Select
              value={operation.orderId}
              onChange={(v) => set("orderId", v)}
              options={[
                ["", "Без заказа"],
                ...data.rows.map((row) => [
                  String(row.id),
                  `${row.number} — ${row.client}`,
                ]),
              ]}
            />
          </Field>
          <Field label="Контрагент">
            <Select
              value={operation.partnerId}
              onChange={(v) => set("partnerId", v)}
              options={[
                ["", "Не выбран"],
                ...data.partners.map((partner) => [
                  String(partner.id),
                  partner.name,
                ]),
              ]}
            />
          </Field>
          {operation.type === "ADJUSTMENT" && (
            <Field label="Направление">
              <Select
                value={operation.adjustmentDirection}
                onChange={(v) => set("adjustmentDirection", v)}
                options={[
                  ["INCOME", "Поступление"],
                  ["EXPENSE", "Расход"],
                ]}
              />
            </Field>
          )}
          <Field label="Комментарий">
            <input
              maxLength={2000}
              value={operation.comment}
              onChange={(e) => set("comment", e.target.value)}
              className="input"
            />
          </Field>
          <button
            disabled={saving}
            className="min-h-11 self-end rounded-xl bg-green-600 px-5 py-3 font-medium text-white disabled:opacity-50"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </form>
      )}
      {success && (
        <p
          role="status"
          className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-sm text-emerald-300"
        >
          {success}
        </p>
      )}
      {error && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-red-900/70 px-4 py-2 text-sm text-white"
          >
            Повторить
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          title="Поступления"
          value={data.cards.receipts}
          color="text-emerald-400"
        />
        <Metric
          title="Расходы"
          value={data.cards.expenses}
          color="text-rose-400"
        />
        <Metric
          title="К получению от клиентов"
          value={data.cards.customerReceivable}
          color="text-amber-300"
        />
        <Metric
          title="К выплате партнёрам"
          value={data.cards.partnerPayable}
          color="text-orange-300"
        />
        <Metric
          title="К выплате сотрудникам"
          value={data.cards.payrollPayable}
          color="text-violet-300"
        />
        <Metric
          title="Валовая маржа заказов"
          value={data.cards.grossMargin}
          color="text-cyan-300"
        />
      </div>
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="min-w-0 rounded-2xl border border-slate-700 bg-[#101827] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold text-white">Динамика поступлений и расходов</h2>
            <span className="text-sm text-slate-400">Денежный поток: {money(data.operationTotals.net)}</span>
          </div>
          {data.trend.length === 0 ? <p className="mt-4 text-sm text-slate-500">За период движений денег нет.</p> : <div className="mt-4 space-y-3">
            {data.trend.map((item) => {
              const max = Math.max(1, ...data.trend.flatMap((point) => [point.income, point.expense]));
              return <div key={item.date} className="grid min-w-0 grid-cols-[5.5rem_1fr] gap-3 text-xs"><span className="text-slate-400">{new Date(`${item.date}T00:00:00`).toLocaleDateString("ru-RU")}</span><div className="space-y-1"><div className="h-2 rounded bg-slate-800"><div className="h-2 rounded bg-emerald-500" style={{ width: `${Math.max(item.income ? 2 : 0, item.income / max * 100)}%` }} /></div><div className="h-2 rounded bg-slate-800"><div className="h-2 rounded bg-rose-500" style={{ width: `${Math.max(item.expense ? 2 : 0, item.expense / max * 100)}%` }} /></div></div></div>;
            })}
          </div>}
        </div>
        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
          <h2 className="font-semibold text-white">Требуют внимания</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <AlertMetric label="Без партнёра" value={data.alerts.withoutPartner} />
            <AlertMetric label="Без цены партнёра" value={data.alerts.withoutPartnerPrice} />
            <AlertMetric label="Просрочено клиентом" value={data.alerts.overdueCustomer} />
            <AlertMetric label="Просрочено партнёру" value={data.alerts.overduePartner} />
          </div>
        </div>
      </section>
      <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
        <h2 className="font-semibold text-white">Расчёты с цехами</h2>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Metric title="Согласовано" value={data.partnerTotals.agreed} color="text-white" />
          <Metric title="Выплачено" value={data.partnerTotals.paid} color="text-emerald-300" />
          <Metric title="Осталось" value={data.partnerTotals.remaining} color="text-amber-300" />
        </div>
        {data.partnerBreakdown.length > 0 && <div className="mt-4 grid gap-2">
          {data.partnerBreakdown.map((item) => <Link key={item.partnerId} href={`/partners/${item.partnerId}`} className="grid min-w-0 gap-2 rounded-xl bg-slate-900 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] sm:items-center"><b className="truncate text-white">{item.partner}</b><span>{item.orders} зак.</span><span>{money(item.agreed)}</span><span className="text-emerald-300">{money(item.paid)}</span><span className="text-amber-300">{money(item.remaining)}</span></Link>)}
        </div>}
      </section>
      <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Движение">
          <Select
            value={direction}
            onChange={setDirection}
            options={[
              ["all", "Все"],
              ["income", "Поступления"],
              ["expense", "Расходы"],
            ]}
          />
        </Field>
        <Field label="Категория">
          <Select
            value={category}
            onChange={setCategory}
            options={[
              ["", "Все категории"],
              ...Object.entries(operationLabels),
            ]}
          />
        </Field>
        <Field label="Поиск">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Заказ, контрагент, комментарий"
            className="input"
          />
        </Field>
      </div>
      {loading ? (
        <Skeleton />
      ) : visible.length === 0 ? (
        <Empty />
      ) : (
        <>
          <div className="grid gap-3 md:hidden">
            {visible.map((item) => (
              <OperationCard key={item.id} item={item} />
            ))}
          </div>
          <div
            data-scroll-region
            className="hidden overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827] md:block"
          >
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead className="bg-slate-900 text-slate-400">
                <tr>
                  {[
                    "Дата",
                    "Операция",
                    "Категория",
                    "Связь",
                    "Сумма",
                    "Автор",
                  ].map((title) => (
                    <th key={title} className="p-4 font-medium">
                      {title}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <OperationRow key={item.id} item={item} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function isOutgoing(item: Operation) {
  return item.direction === "EXPENSE";
}
function OperationLink({ item }: { item: Operation }) {
  return item.order ? (
    <Link
      href={`/orders/${item.order.id}`}
      className="text-blue-400 hover:text-blue-300"
    >
      Заказ №{item.order.number}
    </Link>
  ) : (
    <span>{item.employee ?? item.partner?.name ?? "Без связи"}</span>
  );
}
function OperationRow({ item }: { item: Operation }) {
  const outgoing = isOutgoing(item);
  return (
    <tr className="border-t border-slate-800 text-slate-300">
      <td className="p-4">
        {new Date(item.operationDate).toLocaleDateString("ru-RU")}
      </td>
      <td className="p-4">{outgoing ? "Расход" : "Поступление"}</td>
      <td className="p-4">{operationLabels[item.type] ?? item.type}</td>
      <td className="p-4">
        <OperationLink item={item} />
      </td>
      <td
        className={`p-4 font-semibold ${outgoing ? "text-rose-400" : "text-emerald-400"}`}
      >
        {outgoing ? "−" : "+"}
        {money(item.amount)}
      </td>
      <td className="p-4">{item.author ?? "Система"}</td>
    </tr>
  );
}
function OperationCard({ item }: { item: Operation }) {
  const outgoing = isOutgoing(item);
  return (
    <article className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-white">
            {operationLabels[item.type] ?? item.type}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {new Date(item.operationDate).toLocaleDateString("ru-RU")} ·{" "}
            {item.author ?? "Система"}
          </p>
        </div>
        <p
          className={`shrink-0 font-bold ${outgoing ? "text-rose-400" : "text-emerald-400"}`}
        >
          {outgoing ? "−" : "+"}
          {money(item.amount)}
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-sm text-slate-300">
        <OperationLink item={item} />
        {item.comment && (
          <span>{item.comment.replace(/^\[(INCOME|EXPENSE)\]\s*/, "")}</span>
        )}
      </div>
    </article>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1.5 text-sm text-slate-300">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="input"
    >
      {options.map(([option, label]) => (
        <option key={option} value={option}>
          {label}
        </option>
      ))}
    </select>
  );
}
function Metric({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
      <p className="text-sm text-slate-400">{title}</p>
      <p className={`mt-2 break-words text-2xl font-bold ${color}`}>
        {money(value)}
      </p>
    </div>
  );
}
function AlertMetric({ label, value }: { label: string; value: number }) {
  return <div className="min-w-0 rounded-xl bg-slate-900 p-3"><p className="text-slate-400">{label}</p><p className={`mt-1 text-xl font-bold ${value > 0 ? "text-amber-300" : "text-emerald-300"}`}>{value}</p></div>;
}
function Skeleton() {
  return (
    <div className="space-y-3" aria-label="Загрузка операций">
      {[1, 2, 3].map((item) => (
        <div
          key={item}
          className="h-20 animate-pulse rounded-2xl bg-slate-800/70"
        />
      ))}
    </div>
  );
}
function Empty() {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-[#101827] p-8 text-center">
      <p className="font-medium text-white">
        За выбранный период операций нет.
      </p>
      <p className="mt-1 text-sm text-slate-400">
        Измените период или фильтры.
      </p>
    </div>
  );
}
