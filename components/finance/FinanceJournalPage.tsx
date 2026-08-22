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
type Profitability = {
  totals: {
    sales: number | string;
    grossMargin: number | string;
    directOrderCosts: number | string;
    orderPayrollAccrued: number | string;
    marginAfterDirect: number | string;
    orderProfit: number | string;
    profitBeforeMandatory: number | string;
    companyNetProfit: number | string;
    averageMargin: number | string;
    clientReceived: number | string;
    clientOutstanding: number | string;
    partnerPaid: number | string;
    partnerPayable: number | string;
    payrollPaid: number | string;
    otherExpensesPaid: number | string;
    otherIncome: number | string;
    generalExpenses: number | string;
    marketingExpenses: number | string;
    generalPayrollAccrued: number | string;
    rentExpenses: number | string;
    utilitiesExpenses: number | string;
    administrativeExpenses: number | string;
    otherOperatingExpenses: number | string;
    mandatoryPayments: number | string;
    cashResult: number | string;
    calculatedOrders: number;
    incompleteOrders: number;
  };
  rows: Array<{
    id: number;
    number: string;
    lifecycle: string;
    client: { name: string };
    partner: { name: string } | null;
    economy: {
      client: { totalSale: number | string };
      partner: { accrued: number | string };
      profit: {
        directExpenses: number | string;
        payrollAccrued: number | string;
        netProfit: number | string;
        netMarginPercent: number | string;
        complete: boolean;
        label: string;
      };
    };
  }>;
  highlights: {
    highestProfit?: { number: string; economy: { profit: { netProfit: number | string } } } | null;
    highestMargin?: { number: string; economy: { profit: { netMarginPercent: number | string } } } | null;
    mostPopularProduct?: { product: string; material: string; orders: number } | null;
    mostPopularMaterial?: { material: string; orders: number } | null;
    mostProfitableProduct?: { product: string; material: string; profit: number | string } | null;
  };
  charts: {
    monthly: Array<{ month: string; sales: number | string; grossMargin: number | string; netProfit: number | string; cashResult: number | string }>;
    products: Array<{ name: string; orders: number; profit: number | string }>;
    materials: Array<{ name: string; orders: number; profit: number | string }>;
    partners: Array<{ name: string; orders: number; profit: number | string }>;
    managers: Array<{ name: string; orders: number; profit: number | string }>;
    expenses: Array<{ name: string; amount: number | string }>;
  };
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
const sourceLabels: Record<string, string> = {
  MANUAL: "Ручная",
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
  const isDirector = session?.user.role === "DIRECTOR";
  const [journal, setJournal] = useState(emptyJournal);
  const [profitability, setProfitability] = useState<Profitability | null>(null);
  const [period, setPeriod] = useState("month");
  const [tab, setTab] = useState<
    "overview" | "profit" | "journal" | "expenses" | "cash" | "orders" | "reports"
  >("overview");
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

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      period: period === "custom" ? "all" : period,
      page: String(page),
      pageSize: "50",
    });
    if (tab === "expenses") params.set("direction", "EXPENSE");
    if (period === "custom" && from)
      params.set("from", `${from}T00:00:00`);
    if (period === "custom" && to)
      params.set("to", `${to}T23:59:59.999`);
    if (debouncedSearch) params.set("search", debouncedSearch);
    try {
      const response = await fetch(`/api/finance?${params}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as {
        journal?: Journal;
        profitability?: Profitability;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Не удалось загрузить финансы");
      setJournal(body.journal ?? emptyJournal);
      setProfitability(body.profitability ?? null);
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
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white sm:text-3xl">
            Доходы и расходы
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Единый журнал фактического движения денег
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

      <div className="flex gap-2 overflow-x-auto pb-1">
        {[
          ["today", "Сегодня"],
          ["week", "7 дней"],
          ["month", "Текущий месяц"],
          ["previous_month", "Прошлый месяц"],
          ["year", "Год"],
          ["custom", "Период"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            onClick={() => { setPage(1); setPeriod(value); }}
            className={`min-h-10 shrink-0 rounded-xl px-4 text-sm ${period === value ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
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
          label="Доходы"
          value={journal.totals.income}
          color="text-emerald-300"
        />
        <Metric
          label="Расходы"
          value={journal.totals.expense}
          color="text-rose-300"
        />
        <Metric
          label="Денежный результат"
          value={journal.totals.cashResult}
          color={
            journal.totals.cashResult >= 0 ? "text-blue-300" : "text-rose-300"
          }
        />
      </div>
      <p className="-mt-3 text-xs text-slate-500">
        Денежный результат — фактическое движение денег, а не чистая прибыль.
      </p>
      {profitability && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Прибыль заказов" value={Number(profitability.totals.orderProfit)} color="text-emerald-300" />
          <Metric label="Прибыль до обязательных платежей" value={Number(profitability.totals.profitBeforeMandatory)} color="text-blue-300" />
          <Metric label="Чистая прибыль компании" value={Number(profitability.totals.companyNetProfit)} color={Number(profitability.totals.companyNetProfit) >= 0 ? "text-emerald-300" : "text-rose-300"} />
          <Metric label="Средняя маржа заказов" value={Number(profitability.totals.averageMargin)} color="text-amber-300" suffix="%" />
        </div>
      )}

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
        {([
          ["overview", "Обзор"],
          ["profit", "Прибыль"],
          ["journal", "Журнал"],
          ["expenses", "Расходы"],
          ["cash", "Денежный поток"],
          ["orders", "Экономика заказов"],
          ["reports", "Отчёты"],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => { setPage(1); setTab(value); }}
            className={tabClass(tab === value)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && profitability && (
        <ProfitOverview profitability={profitability} />
      )}
      {tab === "profit" && profitability && (
        <ProfitDetails profitability={profitability} />
      )}
      {tab === "orders" && profitability && (
        <OrderEconomyTable profitability={profitability} />
      )}
      {tab === "reports" && profitability && (
        <ProfitReports profitability={profitability} />
      )}
      {tab === "cash" ? (
        <Analysis journal={journal} />
      ) : (tab === "expenses" || tab === "journal") ? (
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
      ) : null}

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

function ProfitOverview({ profitability }: { profitability: Profitability }) {
  const totals = profitability.totals;
  const netMargin = Number(totals.sales) ? Number(totals.companyNetProfit) / Number(totals.sales) * 100 : 0;
  return (
    <section className="space-y-4 rounded-2xl border border-slate-700 bg-[#101827] p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Продажи" value={Number(totals.sales)} color="text-white" />
        <Metric label="Получено от клиентов" value={Number(totals.clientReceived)} color="text-emerald-300" />
        <Metric label="Валовая маржа заказов" value={Number(totals.grossMargin)} color="text-cyan-300" />
        <Metric label="Прямые расходы заказов" value={Number(totals.directOrderCosts)} color="text-rose-300" />
        <Metric label="Зарплата и бонусы по заказам" value={Number(totals.orderPayrollAccrued)} color="text-rose-300" />
        <Metric label="Маржа после прямых расходов" value={Number(totals.marginAfterDirect)} color="text-blue-300" />
        <Metric label="Реклама" value={Number(totals.marketingExpenses)} color="text-rose-300" />
        <Metric label="Общая зарплата без orderId" value={Number(totals.generalPayrollAccrued)} color="text-rose-300" />
        <Metric label="Аренда" value={Number(totals.rentExpenses)} color="text-rose-300" />
        <Metric label="Коммунальные расходы" value={Number(totals.utilitiesExpenses)} color="text-rose-300" />
        <Metric label="Административные расходы" value={Number(totals.administrativeExpenses)} color="text-rose-300" />
        <Metric label="Другие операционные расходы" value={Number(totals.otherOperatingExpenses)} color="text-rose-300" />
        <Metric label="Прочие операционные доходы" value={Number(totals.otherIncome)} color="text-emerald-300" />
        <Metric label="Прибыль до обязательных платежей" value={Number(totals.profitBeforeMandatory)} color="text-blue-300" />
        <Metric label="Обязательные платежи" value={Number(totals.mandatoryPayments)} color="text-rose-300" />
        <Metric label="Чистая прибыль" value={Number(totals.companyNetProfit)} color={Number(totals.companyNetProfit) >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <Metric label="Чистая маржа" value={netMargin} color={netMargin >= 0 ? "text-emerald-300" : "text-rose-300"} suffix="%" />
        <Metric label="Денежный результат" value={Number(totals.cashResult)} color={Number(totals.cashResult) >= 0 ? "text-emerald-300" : "text-rose-300"} />
        <Metric label="К получению от клиентов" value={Number(totals.clientOutstanding)} color="text-amber-300" />
        <Metric label="К выплате цехам" value={Number(totals.partnerPayable)} color="text-amber-300" />
      </div>
      <p className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-3 text-sm text-blue-100">Денежный результат — это движение денег, а не чистая прибыль.</p>
      <p className="text-sm text-slate-400">Рассчитано заказов: {totals.calculatedOrders}. Неполный расчёт: {totals.incompleteOrders}.</p>
    </section>
  );
}

function ProfitDetails({ profitability }: { profitability: Profitability }) {
  const { totals, highlights } = profitability;
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Вклад заказов" value={Number(totals.orderProfit)} color="text-emerald-300" />
        <Metric label="Прочие доходы" value={Number(totals.otherIncome)} color="text-emerald-300" />
        <Metric label="Операционные расходы" value={Number(totals.generalExpenses)} color="text-rose-300" />
        <Metric label="Прибыль до обязательных платежей" value={Number(totals.profitBeforeMandatory)} color="text-blue-300" />
        <Metric label="Обязательные платежи" value={Number(totals.mandatoryPayments)} color="text-rose-300" />
        <Metric label="Чистая прибыль компании" value={Number(totals.companyNetProfit)} color={Number(totals.companyNetProfit) >= 0 ? "text-emerald-300" : "text-rose-300"} />
      </section>
      <section className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:grid-cols-2">
        <Highlight label="Самый прибыльный заказ" value={highlights.highestProfit ? `${highlights.highestProfit.number} · ${money(Number(highlights.highestProfit.economy.profit.netProfit))}` : "Нет полного расчёта"} />
        <Highlight label="Самый маржинальный заказ" value={highlights.highestMargin ? `${highlights.highestMargin.number} · ${Number(highlights.highestMargin.economy.profit.netMarginPercent).toLocaleString("ru-RU")}%` : "Нет полного расчёта"} />
        <Highlight label="Самый ходовой товар" value={highlights.mostPopularProduct ? `${highlights.mostPopularProduct.product} · ${highlights.mostPopularProduct.orders}` : "Нет данных"} />
        <Highlight label="Самый ходовой материал" value={highlights.mostPopularMaterial ? `${highlights.mostPopularMaterial.material} · ${highlights.mostPopularMaterial.orders}` : "Нет данных"} />
        <Highlight label="Самый прибыльный товар" value={highlights.mostProfitableProduct ? `${highlights.mostProfitableProduct.product} · ${money(Number(highlights.mostProfitableProduct.profit))}` : "Нет полного расчёта"} />
      </section>
    </div>
  );
}

function ProfitReports({ profitability }: { profitability: Profitability }) {
  const groups = [
    ["Прибыль по товарам", profitability.charts.products],
    ["Прибыль по материалам", profitability.charts.materials],
    ["Прибыль по цехам", profitability.charts.partners],
    ["Прибыль по менеджерам", profitability.charts.managers],
  ] as const;
  return <div className="grid gap-4 xl:grid-cols-2">
    <section className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827] p-4 xl:col-span-2"><h2 className="font-semibold text-white">Продажи, валовая маржа, чистая прибыль и денежный результат</h2><div className="mt-4 min-w-[600px] space-y-2">{profitability.charts.monthly.map((item) => <div key={item.month} className="grid grid-cols-[5rem_repeat(4,minmax(0,1fr))] gap-3 rounded-xl bg-slate-950/60 p-3 text-xs"><b>{item.month}</b><ReportValue label="Продажи" value={item.sales}/><ReportValue label="Валовая маржа" value={item.grossMargin}/><ReportValue label="Чистая прибыль" value={item.netProfit}/><ReportValue label="Деньги" value={item.cashResult}/></div>)}</div></section>
    {groups.map(([title, rows]) => <section key={title} className="rounded-2xl border border-slate-700 bg-[#101827] p-4"><h2 className="font-semibold text-white">{title}</h2><ReportBars rows={rows}/></section>)}
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 xl:col-span-2"><h2 className="font-semibold text-white">Расходы по категориям</h2><ReportBars rows={profitability.charts.expenses.map((item) => ({ name: item.name, orders: 0, profit: item.amount }))}/></section>
  </div>;
}

function ReportValue({ label, value }: { label: string; value: number | string }) {
  return <span><span className="block text-slate-500">{label}</span><b className={Number(value) < 0 ? "text-rose-300" : "text-slate-200"}>{money(Number(value))}</b></span>;
}

function ReportBars({ rows }: { rows: Array<{ name: string; orders: number; profit: number | string }> }) {
  const top = [...rows].sort((left, right) => Math.abs(Number(right.profit)) - Math.abs(Number(left.profit))).slice(0, 10);
  const maximum = Math.max(1, ...top.map((item) => Math.abs(Number(item.profit))));
  return <div className="mt-4 space-y-3">{top.map((item) => <div key={item.name}><div className="flex justify-between gap-3 text-xs"><span className="truncate">{item.name}{item.orders ? ` · ${item.orders}` : ""}</span><b>{money(Number(item.profit))}</b></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-800"><div className={Number(item.profit) < 0 ? "h-full rounded-full bg-rose-400" : "h-full rounded-full bg-emerald-400"} style={{ width: `${Math.max(2, Math.abs(Number(item.profit)) / maximum * 100)}%` }}/></div></div>)}</div>;
}

function Highlight({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-slate-950/60 p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-semibold text-white">{value}</p></div>;
}

function OrderEconomyTable({ profitability }: { profitability: Profitability }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
      <table className="w-full min-w-[980px] text-left text-sm">
        <thead className="bg-slate-950 text-slate-400"><tr>{["Заказ", "Клиент", "Цех", "Продажа", "Стоимость цеха", "Прямые расходы", "Начисления", "Прибыль", "Маржа", "Полнота"].map((title) => <th key={title} className="px-3 py-3">{title}</th>)}</tr></thead>
        <tbody>{profitability.rows.map((row) => <tr key={row.id} className="border-t border-slate-800 text-slate-200">
          <td className="px-3 py-3"><a href={`/orders/${row.id}`} className="font-semibold text-blue-300">{row.number}</a></td>
          <td className="px-3 py-3">{row.client.name}</td>
          <td className="px-3 py-3">{row.partner?.name ?? "Не передан в цех"}</td>
          <td className="px-3 py-3">{money(Number(row.economy.client.totalSale))}</td>
          <td className="px-3 py-3">{row.economy.profit.complete ? money(Number(row.economy.partner.accrued)) : "—"}</td>
          <td className="px-3 py-3">{money(Number(row.economy.profit.directExpenses))}</td>
          <td className="px-3 py-3">{money(Number(row.economy.profit.payrollAccrued))}</td>
          <td className="px-3 py-3 font-semibold">{row.economy.profit.complete ? money(Number(row.economy.profit.netProfit)) : "—"}</td>
          <td className="px-3 py-3">{row.economy.profit.complete ? `${Number(row.economy.profit.netMarginPercent).toLocaleString("ru-RU")}%` : "—"}</td>
          <td className="px-3 py-3">{row.economy.profit.label}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

function Metric({
  label,
  value,
  color,
  suffix,
}: {
  label: string;
  value: number;
  color: string;
  suffix?: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`mt-2 break-words text-xl font-bold ${color}`}>
        {suffix ? `${value.toLocaleString("ru-RU")} ${suffix}` : money(value)}
      </p>
    </div>
  );
}

function tabClass(active: boolean) {
  return `min-h-10 shrink-0 rounded-xl px-4 text-sm ${active ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`;
}

function Analysis({ journal }: { journal: Journal }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Breakdown
        title="Доходы по категориям"
        rows={journal.incomeByCategory}
        color="text-emerald-300"
      />
      <Breakdown
        title="Расходы по категориям"
        rows={journal.expenseByCategory}
        color="text-rose-300"
      />
      <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 lg:col-span-2">
        <h2 className="font-semibold text-white">Динамика</h2>
        {journal.timeline.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Нет данных.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {journal.timeline.map((item) => (
              <div
                key={item.date}
                className="grid grid-cols-[5.5rem_1fr_1fr] gap-2 text-sm"
              >
                <span className="text-slate-400">
                  {new Date(`${item.date}T00:00:00`).toLocaleDateString("ru-RU")}
                </span>
                <span className="truncate text-emerald-300">
                  +{money(item.income)}
                </span>
                <span className="truncate text-rose-300">
                  −{money(item.expense)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Breakdown({
  title,
  rows,
  color,
}: {
  title: string;
  rows: { code: string; name: string; amount: number }[];
  color: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4">
      <h2 className="font-semibold text-white">{title}</h2>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">Нет данных.</p>
        ) : (
          rows.map((item) => (
            <div
              key={item.code}
              className="flex justify-between gap-3 text-sm"
            >
              <span className="text-slate-300">{item.name}</span>
              <b className={color}>{money(item.amount)}</b>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
