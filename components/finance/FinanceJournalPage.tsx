"use client";

import { useSession } from "next-auth/react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import BankStatementPanel from "@/components/finance/BankStatementPanel";
import RecurringExpensesPanel from "@/components/finance/RecurringExpensesPanel";
import { recurringJournalMonth } from "@/lib/finance/recurring-period";

type Direction = "INCOME" | "EXPENSE";
type Option = { id: number; name: string };
type Category = Option & {
  code: string;
  direction: Direction;
  system: boolean;
  active: boolean;
};
type Operation = {
  id: string;
  sourceId: number;
  source: string;
  system: boolean;
  editable: boolean;
  voided: boolean;
  direction: Direction;
  categoryId: number | null;
  categoryName: string;
  amount: number;
  method: string;
  counterparty: string | null;
  comment: string | null;
  author: string | null;
  operationDate: string;
  order: {
    id: number;
    number: string;
    client: { id?: number; name: string };
  } | null;
  client: Option | null;
  partner: Option | null;
  employee: Option | null;
};
type Journal = {
  operations: Operation[];
  totals: { income: number; expense: number; cashResult: number };
  incomeByCategory: { code: string; name: string; amount: number }[];
  expenseByCategory: { code: string; name: string; amount: number }[];
  expenseGroups: {
    key: "FIXED" | "ONE_TIME" | "PRODUCTION" | "PAYROLL";
    name: string;
    description: string;
    amount: number;
  }[];
  timeline: { date: string; income: number; expense: number }[];
  categories: Category[];
  options: {
    orders: Option[];
    clients: Option[];
    partners: Option[];
    employees: Option[];
  };
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};
type Form = {
  direction: Direction;
  categoryId: string;
  amount: string;
  operationDate: string;
  method: string;
  counterparty: string;
  comment: string;
  orderId: string;
  clientId: string;
  partnerId: string;
  employeeId: string;
};

const emptyJournal: Journal = {
  operations: [],
  totals: { income: 0, expense: 0, cashResult: 0 },
  incomeByCategory: [],
  expenseByCategory: [],
  expenseGroups: [],
  timeline: [],
  categories: [],
  options: { orders: [], clients: [], partners: [], employees: [] },
  pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
};
const localDate = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const blank = (direction: Direction): Form => ({
  direction,
  categoryId: "",
  amount: "",
  operationDate: localDate(),
  method: "kaspi",
  counterparty: "",
  comment: "",
  orderId: "",
  clientId: "",
  partnerId: "",
  employeeId: "",
});
const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(value || 0);
const businessDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
const fullMonthRange = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(lastDay).padStart(2, "0")}`,
  };
};
const monthName = (month: string) =>
  new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(`${month}-01T00:00:00+05:00`),
  );
const periodCaption = (period: string, from: string, to: string) => {
  const today = businessDate();
  if (period === "today")
    return `Факт на ${new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Almaty" }).format(new Date())}`;
  if (period === "month")
    return `Факт за ${monthName(today.slice(0, 7))}: с 1-го по ${Number(today.slice(8, 10))}-е число`;
  if (period === "previous_month") {
    const previous = new Date(`${today.slice(0, 7)}-01T00:00:00+05:00`);
    previous.setUTCDate(0);
    const key = businessDate(previous).slice(0, 7);
    return `Полный итог за ${monthName(key)}`;
  }
  if (period === "week") return "Последние 7 календарных дней";
  if (period === "year") return `С начала ${today.slice(0, 4)} года`;
  if (period === "custom" && from && to) {
    if (from.slice(0, 7) === to.slice(0, 7)) return `Итог за ${monthName(from.slice(0, 7))}`;
    return `${new Date(`${from}T00:00:00+05:00`).toLocaleDateString("ru-RU")} — ${new Date(`${to}T00:00:00+05:00`).toLocaleDateString("ru-RU")}`;
  }
  return "Выбранный период";
};
const sourceLabels: Record<string, string> = {
  MANUAL: "Ручная",
  BANK_STATEMENT: "Выписка Kaspi",
  RECURRING_EXPENSE: "Постоянная",
  CLIENT_PAYMENT: "Оплата клиента",
  PARTNER_PAYOUT: "Выплата цеху",
  PAYROLL_PAYMENT: "Зарплата",
  REFUND: "Возврат",
  OTHER_SYSTEM: "Системная",
};
const methodLabels: Record<string, string> = {
  cash: "Наличные",
  kaspi: "Kaspi",
  bank_transfer: "Банк",
  card: "Карта",
  other: "Другое",
};

export default function FinanceJournalPage() {
  const { data: session } = useSession();
  const accountRole = session?.user.accountRole || session?.user.role;
  const isDirector = accountRole === "DIRECTOR" || accountRole === "OPERATIONS_DIRECTOR";
  const [journal, setJournal] = useState(emptyJournal);
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [manageCategories, setManageCategories] = useState(false);
  const { getKey, reset } = useIdempotencyKey();
  const caption = useMemo(
    () => periodCaption(period, from, to),
    [from, period, to],
  );
  const monthPickerValue = useMemo(() => {
    if (period === "custom" && from && from.slice(0, 7) === to.slice(0, 7))
      return from.slice(0, 7);
    const today = businessDate();
    if (period === "month") return today.slice(0, 7);
    if (period === "previous_month") {
      const first = new Date(`${today.slice(0, 7)}-01T00:00:00+05:00`);
      first.setUTCDate(0);
      return businessDate(first).slice(0, 7);
    }
    return "";
  }, [from, period, to]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      period: period === "custom" ? "all" : period,
      page: String(page),
      pageSize: "50",
    });
    if (tab === "income") params.set("direction", "INCOME");
    if (tab === "expense") params.set("direction", "EXPENSE");
    if (period === "custom" && from)
      params.set("from", `${from}T00:00:00+05:00`);
    if (period === "custom" && to)
      params.set("to", `${to}T23:59:59.999+05:00`);
    if (debouncedSearch) params.set("search", debouncedSearch);
    try {
      const response = await fetch(`/api/finance?${params}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        journal?: Journal;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Не удалось загрузить финансы");
      setJournal(body.journal ?? emptyJournal);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить финансы",
      );
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, from, page, period, tab, to]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    // Initial and filter-driven API synchronization belongs in this effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const categories = useMemo(
    () =>
      journal.categories.filter(
        (item) => item.direction === form?.direction && item.active,
      ),
    [form?.direction, journal.categories],
  );
  const visible = journal.operations;

  const set = (field: keyof Form, value: string) =>
    setForm((current) => (current ? { ...current, [field]: value } : current));
  const openCreate = (direction: Direction) => {
    setEditing(null);
    setForm(blank(direction));
    setMessage("");
  };
  const selectMonth = (month: string) => {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    const range = fullMonthRange(month);
    setPage(1);
    setFrom(range.from);
    setTo(range.to);
    setPeriod("custom");
  };
  const openEdit = (item: Operation) => {
    setEditing(item.sourceId);
    setForm({
      direction: item.direction,
      categoryId: item.categoryId ? String(item.categoryId) : "",
      amount: String(item.amount),
      operationDate: item.operationDate.slice(0, 10),
      method: item.method,
      counterparty: item.counterparty ?? "",
      comment: item.comment ?? "",
      orderId: item.order ? String(item.order.id) : "",
      clientId: item.client ? String(item.client.id) : "",
      partnerId: item.partner ? String(item.partner.id) : "",
      employeeId: item.employee ? String(item.employee.id) : "",
    });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        editing ? `/api/finance/entries/${editing}` : "/api/finance",
        {
          method: editing ? "PATCH" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(editing ? {} : { "Idempotency-Key": getKey() }),
          },
          body: JSON.stringify(form),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Не удалось сохранить операцию");
      if (!editing) reset();
      setForm(null);
      setEditing(null);
      setMessage(editing ? "Операция обновлена." : "Операция добавлена.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось сохранить операцию",
      );
    } finally {
      setSaving(false);
    }
  }

  async function voidEntry(item: Operation) {
    const reason = window.prompt("Причина отмены операции");
    if (!reason?.trim()) return;
    const response = await fetch(
      `/api/finance/entries/${item.sourceId}/void`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error || "Не удалось отменить операцию");
      return;
    }
    setMessage("Операция отменена, запись аудита сохранена.");
    await load();
  }

  async function addCategory(direction: Direction) {
    const name = window.prompt(
      direction === "INCOME"
        ? "Название категории дохода"
        : "Название категории расхода",
    );
    if (!name?.trim()) return;
    const response = await fetch("/api/finance/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, direction }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error || "Не удалось создать категорию");
      return;
    }
    await load();
  }

  async function changeCategory(
    category: Category,
    action: "rename" | "archive",
  ) {
    const name =
      action === "rename"
        ? window.prompt("Новое название", category.name)
        : undefined;
    if (action === "rename" && !name?.trim()) return;
    const response = await fetch("/api/finance/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: category.id,
        ...(name ? { name } : {}),
        ...(action === "archive" ? { active: false } : {}),
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error || "Не удалось изменить категорию");
      return;
    }
    await load();
  }

  return (
    <section className="space-y-5 p-4 sm:p-6 md:p-8">
      <header className="flex flex-col gap-4 rounded-3xl border border-slate-700 bg-gradient-to-br from-[#121d30] to-[#0b1220] p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">Финансы компании</p>
          <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Деньги за период</h1>
          <p className="mt-1 text-sm text-slate-400">
            {caption}. Только реальные поступления и фактические расходы.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => openCreate("INCOME")}
            className="min-h-11 rounded-xl bg-emerald-600 px-4 font-semibold text-white"
          >
            + Доход
          </button>
          <button
            type="button"
            onClick={() => openCreate("EXPENSE")}
            className="min-h-11 rounded-xl bg-rose-600 px-4 font-semibold text-white"
          >
            + Расход
          </button>
        </div>
      </header>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-3 sm:p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex gap-2 overflow-x-auto pb-1 xl:pb-0">
            {[
              ["month", "Текущий месяц"],
              ["previous_month", "Прошлый месяц"],
              ["today", "Сегодня"],
              ["week", "7 дней"],
              ["year", "Год"],
              ["custom", "Другой период"],
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                onClick={() => { setPage(1); setPeriod(value); }}
                className={`min-h-10 shrink-0 rounded-xl px-4 text-sm font-medium ${period === value ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300 hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-300">
            <span>Выбрать месяц</span>
            <input
              aria-label="Выбрать финансовый месяц"
              type="month"
              value={monthPickerValue}
              onChange={(event) => selectMonth(event.target.value)}
              className="bg-transparent font-semibold text-white outline-none"
            />
          </label>
        </div>
      </div>
      {period === "custom" && (
        <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:grid-cols-2">
          <Field label="С даты">
            <input
              type="date"
              value={from}
              onChange={(event) => { setPage(1); setFrom(event.target.value); }}
              className="input"
            />
          </Field>
          <Field label="По дату">
            <input
              type="date"
              value={to}
              onChange={(event) => { setPage(1); setTo(event.target.value); }}
              className="input"
            />
          </Field>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Поступило денег"
          value={journal.totals.income}
          color="text-emerald-300"
          hint="Оплаты клиентов и другие поступления"
        />
        <Metric
          label="Фактически выплачено"
          value={journal.totals.expense}
          color="text-rose-300"
          hint="Движение денег: операционные траты, зарплата и выплаты цехам"
        />
        <Metric
          label="Чистый денежный поток"
          value={journal.totals.cashResult}
          color={
            journal.totals.cashResult >= 0 ? "text-blue-300" : "text-rose-300"
          }
          hint="Поступления минус расходы — это не бухгалтерская прибыль"
        />
      </div>

      <CashFlowStatus journal={journal} caption={caption} />

      <ExpenseOverview journal={journal} />

      <RecurringExpensesPanel journalMonth={recurringJournalMonth(period, from, to)} onChanged={() => void load()} />

      <details className="rounded-2xl border border-slate-700 bg-[#101827]">
        <summary className="cursor-pointer list-none p-4 font-semibold text-white sm:p-5">
          Импорт банковской выписки <span className="ml-2 text-sm font-normal text-slate-400">для быстрой сверки Kaspi и банка</span>
        </summary>
        <div className="border-t border-slate-800 p-3 sm:p-4">
          <BankStatementPanel onChanged={() => void load()} />
        </div>
      </details>

      {form && (
        <form
          onSubmit={submit}
          className="grid gap-4 rounded-2xl border border-blue-800/60 bg-[#101827] p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <h2 className="font-semibold text-white sm:col-span-2 lg:col-span-3">
            {editing
              ? "Изменить операцию"
              : form.direction === "INCOME"
                ? "Новый доход"
                : "Новый расход"}
          </h2>
          <Field label="Сумма">
            <input
              required
              min="0.01"
              step="0.01"
              type="number"
              value={form.amount}
              onChange={(event) => set("amount", event.target.value)}
              className="input"
            />
          </Field>
          <Field label="Категория">
            <select
              required
              value={form.categoryId}
              onChange={(event) => set("categoryId", event.target.value)}
              className="input"
            >
              <option value="">Выберите</option>
              {categories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Дата">
            <input
              required
              type="date"
              value={form.operationDate}
              onChange={(event) => set("operationDate", event.target.value)}
              className="input"
            />
          </Field>
          <Field label="Способ оплаты">
            <select
              value={form.method}
              onChange={(event) => set("method", event.target.value)}
              className="input"
            >
              {Object.entries(methodLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Заказ">
            <Options
              value={form.orderId}
              setValue={(value) => set("orderId", value)}
              options={journal.options.orders}
              empty="Без заказа"
            />
          </Field>
          {form.direction === "INCOME" ? (
            <Field label="Клиент">
              <Options
                value={form.clientId}
                setValue={(value) => set("clientId", value)}
                options={journal.options.clients}
                empty="Не выбран"
              />
            </Field>
          ) : (
            <>
              <Field label="Партнёр">
                <Options
                  value={form.partnerId}
                  setValue={(value) => set("partnerId", value)}
                  options={journal.options.partners}
                  empty="Не выбран"
                />
              </Field>
              <Field label="Сотрудник">
                <Options
                  value={form.employeeId}
                  setValue={(value) => set("employeeId", value)}
                  options={journal.options.employees}
                  empty="Не выбран"
                />
              </Field>
              <Field label="Контрагент">
                <input
                  maxLength={200}
                  value={form.counterparty}
                  onChange={(event) => set("counterparty", event.target.value)}
                  className="input"
                />
              </Field>
            </>
          )}
          <Field label="Комментарий">
            <input
              maxLength={2000}
              value={form.comment}
              onChange={(event) => set("comment", event.target.value)}
              className="input"
            />
          </Field>
          <div className="flex gap-2 self-end">
            <button
              disabled={saving}
              className="min-h-11 flex-1 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50"
            >
              {saving ? "Сохранение…" : "Сохранить"}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="min-h-11 rounded-xl bg-slate-700 px-4 text-white"
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {message && (
        <p
          role="status"
          className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300"
        >
          {message}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}

      <div className="flex gap-2 overflow-x-auto">
        <button
          type="button"
          onClick={() => { setPage(1); setTab("all"); }}
          className={tabClass(tab === "all")}
        >
          Все
        </button>
        <button
          type="button"
          onClick={() => { setPage(1); setTab("income"); }}
          className={tabClass(tab === "income")}
        >
          Доходы
        </button>
        <button
          type="button"
          onClick={() => { setPage(1); setTab("expense"); }}
          className={tabClass(tab === "expense")}
        >
          Расходы
        </button>
      </div>

      <>
          <input
            aria-label="Поиск операций"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Поиск: заказ, клиент, контрагент, комментарий"
            className="input w-full"
          />
          {loading ? (
            <p className="text-sm text-slate-400">Загрузка…</p>
          ) : visible.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
              За период операций нет.
            </p>
          ) : (
            <div className="space-y-3">
              <div className="space-y-2">
                {visible.map((item) => (
                <article
                  key={item.id}
                  className={`rounded-2xl border p-4 ${item.voided ? "border-slate-800 opacity-60" : "border-slate-700 bg-[#101827]"}`}
                >
                  <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center">
                    <div
                      className={`h-1 w-full shrink-0 rounded sm:h-10 sm:w-1 ${item.direction === "INCOME" ? "bg-emerald-500" : "bg-rose-500"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <b className="text-white">{item.categoryName}</b>
                        <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
                          {sourceLabels[item.source] ?? item.source}
                        </span>
                        {item.voided && (
                          <span className="text-xs text-rose-300">Отменена</span>
                        )}
                      </div>
                      <p className="mt-1 break-words text-sm text-slate-400">
                        {new Date(item.operationDate).toLocaleDateString("ru-RU")} ·{" "}
                        {methodLabels[item.method] ?? item.method}
                        {item.order ? ` · ${item.order.number}` : ""}
                        {item.counterparty ? ` · ${item.counterparty}` : ""}
                        {item.comment ? ` · ${item.comment}` : ""}
                      </p>
                    </div>
                    <b
                      className={
                        item.direction === "INCOME"
                          ? "text-emerald-300"
                          : "text-rose-300"
                      }
                    >
                      {item.direction === "INCOME" ? "+" : "−"}
                      {money(item.amount)}
                    </b>
                    {item.editable && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(item)}
                          className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white"
                        >
                          Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => void voidEntry(item)}
                          className="rounded-lg bg-rose-950 px-3 py-2 text-sm text-rose-200"
                        >
                          Отменить
                        </button>
                      </div>
                    )}
                  </div>
                </article>
                ))}
              </div>
              {journal.pagination.totalPages > 1 && (
                <nav
                  aria-label="Страницы финансового журнала"
                  className="flex flex-wrap items-center justify-center gap-3"
                >
                  <button
                    type="button"
                    disabled={page <= 1 || loading}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                    className="min-h-11 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-40"
                  >
                    Назад
                  </button>
                  <span className="text-sm text-slate-400">
                    {journal.pagination.page} / {journal.pagination.totalPages} · {journal.pagination.total} операций
                  </span>
                  <button
                    type="button"
                    disabled={page >= journal.pagination.totalPages || loading}
                    onClick={() => setPage((value) => value + 1)}
                    className="min-h-11 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-40"
                  >
                    Далее
                  </button>
                </nav>
              )}
            </div>
          )}
      </>

      {isDirector && (
        <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
          <button
            type="button"
            onClick={() => setManageCategories((value) => !value)}
            className="font-semibold text-white"
          >
            Категории {manageCategories ? "▲" : "▼"}
          </button>
          {manageCategories && (
            <div className="mt-4 space-y-4">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void addCategory("INCOME")}
                  className="rounded-lg bg-emerald-800 px-3 py-2 text-sm text-white"
                >
                  + Категория дохода
                </button>
                <button
                  type="button"
                  onClick={() => void addCategory("EXPENSE")}
                  className="rounded-lg bg-rose-800 px-3 py-2 text-sm text-white"
                >
                  + Категория расхода
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {journal.categories
                  .filter((item) => !item.system)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 rounded-xl bg-slate-900 p-3 text-sm"
                    >
                      <span
                        className={
                          item.active
                            ? "text-white"
                            : "text-slate-500 line-through"
                        }
                      >
                        {item.name}
                      </span>
                      {item.active && (
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void changeCategory(item, "rename")}
                            className="text-blue-300"
                          >
                            Изменить
                          </button>
                          <button
                            type="button"
                            onClick={() => void changeCategory(item, "archive")}
                            className="text-amber-300"
                          >
                            В архив
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </section>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}

function Options({
  value,
  setValue,
  options,
  empty,
}: {
  value: string;
  setValue: (value: string) => void;
  options: Option[];
  empty: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => setValue(event.target.value)}
      className="input"
    >
      <option value="">{empty}</option>
      {options.map((item) => (
        <option key={item.id} value={item.id}>
          {item.name}
        </option>
      ))}
    </select>
  );
}

function Metric({
  label,
  value,
  color,
  hint,
}: {
  label: string;
  value: number;
  color: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 break-words text-xl font-bold ${color}`}>
        {money(value)}
      </p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  );
}

function tabClass(active: boolean) {
  return `min-h-10 shrink-0 rounded-xl px-4 text-sm ${active ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`;
}

function CashFlowStatus({ journal, caption }: { journal: Journal; caption: string }) {
  const { income, expense, cashResult } = journal.totals;
  const spentPerThousand = income > 0 ? Math.round((expense / income) * 1000) : null;
  const healthy = cashResult >= 0;
  return (
    <section className={`rounded-2xl border p-4 sm:p-5 ${healthy ? "border-emerald-800/70 bg-emerald-950/20" : "border-rose-800/70 bg-rose-950/20"}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className={`text-sm font-semibold ${healthy ? "text-emerald-300" : "text-rose-300"}`}>
            {income === 0 && expense === 0
              ? "За период ещё нет финансовых операций"
              : healthy
                ? `Денежный поток положительный: +${money(cashResult)}`
                : `Расходы превышают поступления на ${money(Math.abs(cashResult))}`}
          </p>
          <p className="mt-1 text-sm text-slate-400">{caption}</p>
        </div>
        {spentPerThousand !== null && (
          <p className="rounded-xl bg-slate-950/50 px-3 py-2 text-sm text-slate-300">
            На каждые 1 000 ₸ поступлений потрачено <b className="text-white">{spentPerThousand.toLocaleString("ru-RU")} ₸</b>
          </p>
        )}
      </div>
    </section>
  );
}

function ExpenseOverview({ journal }: { journal: Journal }) {
  const total = journal.totals.expense;
  return (
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">Фактические выплаты за период</h2>
        <p className="mt-1 text-sm text-slate-400">Здесь показано движение денег. Цена производства относится к прямой себестоимости заказа, а не к постоянным или разовым расходам компании.</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {journal.expenseGroups.map((group) => {
          const share = total > 0 ? (group.amount / total) * 100 : 0;
          return (
            <article key={group.key} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-white">{group.name}</h3>
                <span className="text-xs text-slate-500">{share.toLocaleString("ru-RU", { maximumFractionDigits: 0 })}%</span>
              </div>
              <p className="mt-2 text-lg font-bold text-rose-300">{money(group.amount)}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{group.description}</p>
            </article>
          );
        })}
      </div>
      <div className="mt-5 grid gap-4 border-t border-slate-800 pt-4 lg:grid-cols-2">
        <CategoryBars
          title="Откуда пришли деньги"
          empty="За выбранный период поступлений пока нет."
          rows={journal.incomeByCategory}
          total={journal.totals.income}
          bar="bg-emerald-500"
        />
        <CategoryBars
          title="Кому и за что выплатили"
          empty="За выбранный период расходов пока нет."
          rows={journal.expenseByCategory}
          total={journal.totals.expense}
          bar="bg-rose-500"
        />
      </div>
    </section>
  );
}

function CategoryBars({
  title,
  empty,
  rows,
  total,
  bar,
}: {
  title: string;
  empty: string;
  rows: { code: string; name: string; amount: number }[];
  total: number;
  bar: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/30 p-4">
      <h3 className="font-semibold text-white">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <div className="mt-3 space-y-3">
          {rows.map((item) => {
            const share = total > 0 ? (item.amount / total) * 100 : 0;
            return (
              <div key={item.code}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-300">{item.name}</span>
                  <b className="whitespace-nowrap text-white">{money(item.amount)}</b>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, share)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
