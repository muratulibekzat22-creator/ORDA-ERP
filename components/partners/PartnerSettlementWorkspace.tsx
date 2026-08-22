"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  HandCoins,
  History,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Wallet,
  X,
} from "lucide-react";

type DecimalLike = string | number;
type Tab =
  "overview" | "partners" | "orders" | "settlements" | "payments" | "reports";
type Partner = {
  id: number;
  name: string;
  kind: string;
  phone?: string | null;
  secondaryPhone?: string | null;
  email?: string | null;
  city?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  businessStatus: string;
  active: boolean;
  archived: boolean;
  comment?: string | null;
  defaultRewardRule: string;
  cooperationStartedAt?: string | null;
  overdueObligations: number;
  averageExecutionDays?: number | null;
  documents: Array<{
    id: number;
    number?: string | null;
    title: string;
    type: string;
  }>;
  totals: Totals & { balance: DecimalLike; partnerPaid: DecimalLike };
};
type Operation = {
  id: number;
  relationId: number;
  type: string;
  status: string;
  amount: DecimalLike;
  adjustmentEffect?: DecimalLike;
  operationDate: string;
  method?: string | null;
  account?: string | null;
  comment?: string | null;
  orderNumber?: string;
  partnerName?: string;
  createdBy?: { name: string };
};
type PartnerOrder = {
  id: number | null;
  relationId: number | null;
  partnerId: number | null;
  partner: Partner | null;
  settlementStatus: string;
  storedSettlementStatus?: string | null;
  disputeReason?: string | null;
  workDueAt?: string | null;
  paymentDueAt?: string | null;
  operations: Operation[];
  metrics: {
    orderAmount: DecimalLike;
    received: DecimalLike;
    clientRemaining: DecimalLike;
    clientOverpayment: DecimalLike;
    companyAmount: DecimalLike;
    companyShareBeforeExpenses: DecimalLike;
    partnerPlanned: DecimalLike;
    partnerAccrued: DecimalLike;
    companyPaidPartner: DecimalLike;
    partnerRemaining: DecimalLike;
    partnerOverpayment: DecimalLike;
    partnerBalance: DecimalLike;
    companyDebt: DecimalLike;
    partnerDebt: DecimalLike;
    companyClientReceived: DecimalLike;
    clientPaidToPartner: DecimalLike;
    partnerTransferred: DecimalLike;
  };
  order: {
    id: number;
    number: string;
    createdAt: string;
    orderReceivedAt: string;
    completedAt?: string | null;
    promisedAt?: string | null;
    lifecycle: string;
    status: string;
    address: string;
    staircase: string;
    material: string;
    amount: DecimalLike;
    companyProfit: DecimalLike;
    client: { id: number; name: string; phone: string; city?: string | null };
    manager: { id: number | null; name: string };
    contract?: { id: number; number?: string | null } | null;
    documents: Array<{
      id: number;
      number?: string | null;
      title: string;
      type: string;
    }>;
    attachments: Array<{ id: number; fileName: string; contentType: string }>;
  };
  economy: {
    client: {
      contractAmount: DecimalLike;
      additionalWorks: DecimalLike;
      discounts: DecimalLike;
      totalSale: DecimalLike;
      netReceived: DecimalLike;
      remaining: DecimalLike;
      overpayment: DecimalLike;
      status: string;
      dueAt?: string | null;
      overdueAmount: DecimalLike;
    };
    partner: {
      agreed: DecimalLike;
      accrued: DecimalLike;
      paid: DecimalLike;
      remaining: DecimalLike;
      overpayment: DecimalLike;
      status: string;
      agreedAt?: string | null;
      dueAt?: string | null;
    };
    profit: {
      directExpenses: DecimalLike;
      materials: DecimalLike;
      delivery: DecimalLike;
      contractors: DecimalLike;
      bankFees: DecimalLike;
      otherDirectExpenses: DecimalLike;
      marginBeforePayroll: DecimalLike;
      managerBonus: DecimalLike;
      measurer: DecimalLike;
      installers: DecimalLike;
      driver: DecimalLike;
      expediter: DecimalLike;
      otherPayroll: DecimalLike;
      payrollAccrued: DecimalLike;
      netProfit: DecimalLike;
      netMarginPercent: DecimalLike;
      complete: boolean;
      warning?: string | null;
      mode: "ACTUAL" | "PLANNED";
    };
    cash: {
      clientReceived: DecimalLike;
      partnerPaid: DecimalLike;
      payrollPaid: DecimalLike;
      otherExpensesPaid: DecimalLike;
      balance: DecimalLike;
    };
  };
};
type Totals = {
  orders: number;
  orderAmount: DecimalLike;
  received: DecimalLike;
  clientRemaining: DecimalLike;
  companyAmount: DecimalLike;
  partnerAccrued: DecimalLike;
  partnerPaid: DecimalLike;
  companyDebt: DecimalLike;
  partnerDebt: DecimalLike;
  directExpenses: DecimalLike;
  marginBeforePayroll: DecimalLike;
  payroll: DecimalLike;
  plannedProfit: DecimalLike;
  actualProfit: DecimalLike;
  profit: DecimalLike;
  averageOrder: DecimalLike;
  averageMargin: DecimalLike | null;
};
type Payload = {
  partners: Partner[];
  orders: PartnerOrder[];
  operations: Operation[];
  unallocatedOperations: Array<{
    id: number;
    operationDate: string;
    amount: DecimalLike;
    counterparty: string;
    partnerId?: number | null;
    orderId?: number | null;
    orderNumber?: string | null;
    comment?: string | null;
    account?: string | null;
    author: string;
  }>;
  audits: Array<{
    id: number;
    partnerId?: number | null;
    relationId?: number | null;
    action: string;
    createdAt: string;
    comment?: string | null;
    actor?: { name: string };
  }>;
  managers: Array<{ id: number; name: string }>;
  totals: Totals & { activePartners: number };
  previousTotals: Totals;
  changes: Record<string, DecimalLike | null>;
  allFilteredTotals: Totals;
  pagination: { page: number; pageSize: number; total: number; pages: number };
  counts: {
    canonical: number;
    active: number;
    completed: number;
    withPartner: number;
    withoutPartner: number;
    withoutCost: number;
    clientUnpaid: number;
    clientPartial: number;
    clientPaid: number;
    partnerPayable: number;
    partnerPartial: number;
    partnerPaid: number;
  };
  period: {
    key: string;
    basis: string;
    from?: string | null;
    to?: string | null;
  };
  charts: {
    monthly: Array<{
      month: string;
      orders: number;
      sales: DecimalLike;
      received: DecimalLike;
      partnerAccrued: DecimalLike;
      partnerPaid: DecimalLike;
      clientOutstanding: DecimalLike;
      partnerPayable: DecimalLike;
      netProfit: DecimalLike;
      netMargin: DecimalLike;
    }>;
    partners: Array<{
      partnerId: number;
      name: string;
      orders: number;
      sales: DecimalLike;
      profit: DecimalLike;
      debt: DecimalLike;
    }>;
    expenses: {
      partner: DecimalLike;
      direct: DecimalLike;
      payroll: DecimalLike;
    };
  };
  highlights: {
    highestProfit: PartnerOrder | null;
    highestMargin: PartnerOrder | null;
    lowestProfit: PartnerOrder | null;
    biggestClientDebt: PartnerOrder | null;
    biggestPartnerDebt: PartnerOrder | null;
    mostProfitablePartner: {
      partnerId: number;
      name: string;
      profit: DecimalLike;
      sales: DecimalLike;
      orders: number;
    } | null;
  };
};
type SearchClient = {
  id: number;
  name: string;
  phone: string;
  city?: string | null;
  address?: string | null;
};

const panel = "rounded-2xl border border-white/10 bg-[#0b1220] p-4 sm:p-5";
const field =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-amber-300";
const primary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-45";
const secondary =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-45";
const danger =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-2 text-sm font-semibold text-red-200 disabled:opacity-45";
const tabs: Array<[Tab, string]> = [
  ["overview", "Обзор"],
  ["partners", "Партнёры"],
  ["orders", "Заказы"],
  ["settlements", "Взаиморасчёты"],
  ["payments", "Выплаты"],
  ["reports", "Отчёты"],
];
const money = (value: DecimalLike | null | undefined) =>
  `${Math.round(Number(value) || 0).toLocaleString("ru-RU")} ₸`;
const number = (value: DecimalLike | null | undefined) => Number(value) || 0;
const percent = (value: DecimalLike | null | undefined) =>
  value == null
    ? "—"
    : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const day = (value?: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "—";
const inputDate = (value?: string | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

const initialFilters = {
  scope: "active",
  clientStatus: "",
  partnerStatus: "",
  profit: "",
  partnerId: "",
  sort: "newest",
  period: "current_month",
  periodBasis: "order",
  from: "",
  to: "",
  page: 1,
};

export default function PartnerSettlementWorkspace({
  initialTab,
  initialOrderId,
}: {
  initialTab?: Tab;
  initialOrderId?: number;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "overview");
  const [data, setData] = useState<Payload | null>(null);
  const [filters, setFilters] = useState(initialFilters);
  const [queryDraft, setQueryDraft] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [agreement, setAgreement] = useState<PartnerOrder | null>(null);
  const [payout, setPayout] = useState<PartnerOrder | null>(null);
  const [adjustment, setAdjustment] = useState<PartnerOrder | null>(null);
  const [historyOrder, setHistoryOrder] = useState<PartnerOrder | null>(null);
  const [historyPayment, setHistoryPayment] = useState<
    Payload["unallocatedOperations"][number] | null
  >(null);
  const [newOrder, setNewOrder] = useState(false);
  const [initialOrderOpened, setInitialOrderOpened] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        scope: filters.scope,
        period: filters.period,
        periodBasis: filters.periodBasis,
        sort: filters.sort,
        page: String(filters.page),
        pageSize: "25",
      });
      if (query) params.set("q", query);
      if (filters.clientStatus)
        params.set("clientStatus", filters.clientStatus);
      if (filters.partnerStatus)
        params.set("partnerStatus", filters.partnerStatus);
      if (filters.profit) params.set("profit", filters.profit);
      if (filters.partnerId) params.set("partnerId", filters.partnerId);
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
      if (initialOrderId) params.set("orderId", String(initialOrderId));
      const response = await fetch(`/api/partner-management?${params}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as Payload & { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось загрузить раздел");
      setData(payload);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить раздел",
      );
    } finally {
      setLoading(false);
    }
  }, [filters, initialOrderId, query]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (!initialOrderId || !data || initialOrderOpened) return;
    const selected = data.orders.find((item) => item.order.id === initialOrderId);
    if (!selected) return;
    const timer = window.setTimeout(() => {
      setTab("orders");
      setHistoryOrder(selected);
      setInitialOrderOpened(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [data, initialOrderId, initialOrderOpened]);

  const mutate = useCallback(
    async (body: Record<string, unknown>, idempotent = false) => {
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const response = await fetch("/api/partner-management", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(idempotent ? { "Idempotency-Key": crypto.randomUUID() } : {}),
          },
          body: JSON.stringify(body),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(apiError(payload.error));
        setNotice("Изменения сохранены");
        await load();
        return true;
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Операция не выполнена",
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const openOrders = (next: Partial<typeof initialFilters>) => {
    setTab("orders");
    setFilters((current) => ({ ...current, ...next, page: 1 }));
  };

  return (
    <main className="min-w-0 space-y-5 overflow-x-hidden p-4 text-slate-100 sm:p-6 md:p-8">
      <header className="relative overflow-hidden rounded-[28px] border border-amber-300/20 bg-[#0b1220] p-5 sm:p-7">
        <div className="absolute inset-x-0 top-0 h-px bg-amber-300/70" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">
              Director workspace
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-white">Партнёры</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-400">
              Все канонические заказы, экономика и фактические взаиморасчёты
              ALTYN SAPA COMPANY.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              className={primary}
              onClick={() => setNewOrder(true)}
            >
              <Plus size={17} />
              Создать заказ без заявки
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={17} className={loading ? "animate-spin" : ""} />
              Обновить
            </button>
          </div>
        </div>
      </header>

      <nav
        aria-label="Разделы партнёров"
        className="flex max-w-full gap-2 overflow-x-auto pb-1"
      >
        {tabs.map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-semibold ${tab === value ? "bg-amber-300 text-slate-950" : "border border-slate-800 bg-slate-900 text-slate-300"}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {initialOrderId && (
        <a href={`/orders/${initialOrderId}#settlements`} className={secondary}>
          <ChevronLeft size={17} /> Вернуться к заказу
        </a>
      )}

      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-500/40 bg-red-950/40 p-4 text-red-200"
        >
          {error}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-emerald-200"
        >
          {notice}
        </div>
      )}
      {loading && !data ? (
        <div className={`${panel} py-16 text-center text-slate-400`}>
          Загрузка реальных данных…
        </div>
      ) : (
        data && (
          <>
            {tab === "overview" && (
              <Overview
                data={data}
                filters={filters}
                setFilters={setFilters}
                openOrders={openOrders}
              />
            )}
            {tab === "partners" && (
              <Partners data={data} busy={busy} mutate={mutate} />
            )}
            {tab === "orders" && (
              <Orders
                data={data}
                filters={filters}
                setFilters={setFilters}
                queryDraft={queryDraft}
                setQueryDraft={setQueryDraft}
                applyQuery={() => {
                  setQuery(queryDraft.trim());
                  setFilters((current) => ({ ...current, page: 1 }));
                }}
                onAgreement={setAgreement}
                onPayout={setPayout}
                onAdjustment={setAdjustment}
                onHistory={setHistoryOrder}
              />
            )}
            {tab === "settlements" && (
              <Settlements
                data={data}
                busy={busy}
                mutate={mutate}
                onPayout={setPayout}
                onAdjustment={setAdjustment}
              />
            )}
            {tab === "payments" && (
              <Payments
                data={data}
                busy={busy}
                mutate={mutate}
                onHistorical={setHistoryPayment}
              />
            )}
            {tab === "reports" && <Reports data={data} />}
          </>
        )
      )}

      {agreement && (
        <AgreementDialog
          order={agreement}
          partners={data?.partners ?? []}
          busy={busy}
          close={() => setAgreement(null)}
          submit={async (body) => {
            if (await mutate(body)) setAgreement(null);
          }}
        />
      )}
      {payout && (
        <PayoutDialog
          order={payout}
          busy={busy}
          close={() => setPayout(null)}
          submit={async (body) => {
            if (await mutate(body, true)) setPayout(null);
          }}
        />
      )}
      {adjustment && (
        <AdjustmentDialog
          order={adjustment}
          busy={busy}
          close={() => setAdjustment(null)}
          submit={async (body) => {
            if (await mutate(body, true)) setAdjustment(null);
          }}
        />
      )}
      {historyOrder && (
        <OrderHistoryDialog
          order={historyOrder}
          close={() => setHistoryOrder(null)}
        />
      )}
      {historyPayment && data && (
        <HistoricalLinkDialog
          payment={historyPayment}
          orders={data.orders}
          partners={data.partners}
          busy={busy}
          close={() => setHistoryPayment(null)}
          submit={async (body) => {
            if (await mutate(body, true)) setHistoryPayment(null);
          }}
        />
      )}
      {newOrder && data && (
        <NewOrderDialog
          data={data}
          busy={busy}
          close={() => setNewOrder(false)}
          submit={async (body) => {
            if (await mutate(body, true)) setNewOrder(false);
          }}
        />
      )}
    </main>
  );
}

function PeriodControls({
  filters,
  setFilters,
}: {
  filters: typeof initialFilters;
  setFilters: React.Dispatch<React.SetStateAction<typeof initialFilters>>;
}) {
  return (
    <div className={`${panel} grid gap-3 md:grid-cols-3 xl:grid-cols-5`}>
      <Select
        label="Период"
        value={filters.period}
        onChange={(period) =>
          setFilters((current) => ({ ...current, period, page: 1 }))
        }
        options={periodOptions}
      />
      <Select
        label="Основа периода"
        value={filters.periodBasis}
        onChange={(periodBasis) =>
          setFilters((current) => ({ ...current, periodBasis, page: 1 }))
        }
        options={basisOptions}
      />
      {filters.period === "custom" && (
        <>
          <Input
            label="С"
            type="date"
            value={filters.from}
            onChange={(from) =>
              setFilters((current) => ({ ...current, from, page: 1 }))
            }
          />
          <Input
            label="По"
            type="date"
            value={filters.to}
            onChange={(to) =>
              setFilters((current) => ({ ...current, to, page: 1 }))
            }
          />
        </>
      )}
      <div className="flex items-end">
        <p className="rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-400">
          {basisDescription(filters.periodBasis)}
        </p>
      </div>
    </div>
  );
}

function Overview({
  data,
  filters,
  setFilters,
  openOrders,
}: {
  data: Payload;
  filters: typeof initialFilters;
  setFilters: React.Dispatch<React.SetStateAction<typeof initialFilters>>;
  openOrders: (next: Partial<typeof initialFilters>) => void;
}) {
  const cards = [
    {
      label: "Активные партнёры",
      value: String(data.totals.activePartners),
      click: () => undefined,
    },
    {
      label: "Активные заказы",
      value: String(data.counts.active),
      click: () => openOrders({ scope: "active" }),
    },
    {
      label: "Сумма продаж",
      value: money(data.totals.orderAmount),
      change: data.changes.orderAmount,
      click: () => openOrders({ scope: "active", sort: "sale_desc" }),
    },
    {
      label: "Получено от клиентов",
      value: money(data.totals.received),
      change: data.changes.received,
      click: () => openOrders({ scope: "active" }),
    },
    {
      label: "Остаток клиентов",
      value: money(data.totals.clientRemaining),
      change: data.changes.clientRemaining,
      click: () => openOrders({ scope: "active", sort: "client_debt_desc" }),
    },
    {
      label: "Согласовано партнёрам",
      value: money(data.totals.partnerAccrued),
      change: data.changes.partnerAccrued,
      click: () => openOrders({ scope: "with_partner" }),
    },
    {
      label: "Начислено партнёрам",
      value: money(data.totals.partnerAccrued),
      change: data.changes.partnerAccrued,
      click: () => openOrders({ scope: "with_partner" }),
    },
    {
      label: "Выплачено партнёрам",
      value: money(data.totals.partnerPaid),
      change: data.changes.partnerPaid,
      click: () => openOrders({ scope: "with_partner" }),
    },
    {
      label: "Осталось выплатить",
      value: money(data.totals.companyDebt),
      change: data.changes.companyDebt,
      click: () => openOrders({ scope: "active", sort: "partner_debt_desc" }),
    },
    {
      label: "Маржа до зарплаты",
      value: money(data.totals.marginBeforePayroll),
      change: data.changes.marginBeforePayroll,
      click: () => openOrders({ scope: "active", sort: "profit_desc" }),
    },
    {
      label: "Зарплата по заказам",
      value: money(data.totals.payroll),
      change: data.changes.payroll,
      click: () => openOrders({ scope: "active" }),
    },
    {
      label: "Плановая чистая прибыль",
      value: money(data.totals.plannedProfit),
      change: data.changes.profit,
      click: () => openOrders({ scope: "active", sort: "profit_desc" }),
    },
    {
      label: "Фактическая чистая прибыль",
      value: money(data.totals.actualProfit),
      change: data.changes.profit,
      click: () => openOrders({ scope: "completed", sort: "profit_desc" }),
    },
    {
      label: "Средняя чистая маржа",
      value: percent(data.totals.averageMargin),
      change: data.changes.profit,
      click: () => openOrders({ scope: "active", sort: "margin_desc" }),
    },
  ];
  return (
    <div className="space-y-5">
      <PeriodControls filters={filters} setFilters={setFilters} />
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            type="button"
            key={card.label}
            onClick={card.click}
            className={`${panel} text-left transition hover:border-amber-300/40`}
          >
            <p className="text-xs text-slate-400 sm:text-sm">{card.label}</p>
            <p className="mt-2 break-words text-lg font-bold text-white sm:text-2xl">
              {card.value}
            </p>
            {card.change !== undefined && <Change value={card.change} />}
          </button>
        ))}
      </section>
      <Highlights data={data} openOrders={openOrders} />
      <AnalyticsCharts data={data} />
    </div>
  );
}

function Change({ value }: { value: DecimalLike | null }) {
  if (value == null)
    return <p className="mt-2 text-xs text-slate-500">Нет базы сравнения</p>;
  const up = number(value) >= 0;
  return (
    <p
      className={`mt-2 flex items-center gap-1 text-xs ${up ? "text-emerald-400" : "text-red-400"}`}
    >
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{" "}
      {percent(Math.abs(number(value)))} к предыдущему периоду
    </p>
  );
}

function Highlights({
  data,
  openOrders,
}: {
  data: Payload;
  openOrders: (next: Partial<typeof initialFilters>) => void;
}) {
  const cards: Array<{
    label: string;
    row: PartnerOrder | null;
    value: DecimalLike;
    suffix?: "margin";
    filter: Partial<typeof initialFilters>;
  }> = [
    {
      label: "Самая высокая чистая прибыль",
      row: data.highlights.highestProfit,
      value: data.highlights.highestProfit?.economy.profit.netProfit ?? 0,
      filter: { profit: "highest_profit", sort: "profit_desc" },
    },
    {
      label: "Самая высокая маржа",
      row: data.highlights.highestMargin,
      value:
        data.highlights.highestMargin?.economy.profit.netMarginPercent ?? 0,
      suffix: "margin",
      filter: { profit: "highest_margin", sort: "margin_desc" },
    },
    {
      label: "Самая низкая прибыль",
      row: data.highlights.lowestProfit,
      value: data.highlights.lowestProfit?.economy.profit.netProfit ?? 0,
      filter: { profit: "lowest_margin", sort: "margin_asc" },
    },
    {
      label: "Самый большой долг клиента",
      row: data.highlights.biggestClientDebt,
      value: data.highlights.biggestClientDebt?.metrics.clientRemaining ?? 0,
      filter: { sort: "client_debt_desc" },
    },
    {
      label: "Самая большая задолженность партнёру",
      row: data.highlights.biggestPartnerDebt,
      value: data.highlights.biggestPartnerDebt?.metrics.companyDebt ?? 0,
      filter: { sort: "partner_debt_desc" },
    },
  ];
  return (
    <section>
      <h2 className="mb-3 text-xl font-bold">Самые важные заказы</h2>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <button
            key={card.label}
            type="button"
            onClick={() => openOrders(card.filter)}
            className={`${panel} text-left hover:border-amber-300/40`}
          >
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {card.label}
            </p>
            {card.row ? (
              <>
                <p className="mt-2 font-bold text-white">
                  {card.row.order.number} · {card.row.order.client.name}
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {card.row.partner?.name ?? "Партнёр не назначен"}
                </p>
                <p className="mt-3 text-xl font-bold text-amber-300">
                  {card.suffix === "margin"
                    ? percent(card.value)
                    : money(card.value)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Продажа {money(card.row.economy.client.totalSale)} · маржа{" "}
                  {percent(card.row.economy.profit.netMarginPercent)}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Нет полного расчёта</p>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            data.highlights.mostProfitablePartner &&
            openOrders({
              partnerId: String(
                data.highlights.mostProfitablePartner.partnerId,
              ),
              scope: "with_partner",
            })
          }
          className={`${panel} text-left hover:border-amber-300/40`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Самый прибыльный партнёр
          </p>
          <p className="mt-2 font-bold text-white">
            {data.highlights.mostProfitablePartner?.name ??
              "Нет полного расчёта"}
          </p>
          <p className="mt-3 text-xl font-bold text-amber-300">
            {money(data.highlights.mostProfitablePartner?.profit)}
          </p>
        </button>
      </div>
    </section>
  );
}

function AnalyticsCharts({ data }: { data: Payload }) {
  const monthly = data.charts.monthly.map((item) =>
    Object.fromEntries(
      Object.entries(item).map(([key, value]) => [
        key,
        key === "month" ? value : Number(value),
      ]),
    ),
  );
  const partners = data.charts.partners
    .map((item) => ({
      ...item,
      sales: number(item.sales),
      profit: number(item.profit),
      debt: number(item.debt),
    }))
    .slice(0, 10);
  const expenses = [
    {
      name: "Партнёр",
      value: number(data.charts.expenses.partner),
      color: "#fbbf24",
    },
    {
      name: "Прямые расходы",
      value: number(data.charts.expenses.direct),
      color: "#38bdf8",
    },
    {
      name: "Зарплата",
      value: number(data.charts.expenses.payroll),
      color: "#a78bfa",
    },
  ];
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xl font-bold">Аналитика</h2>
        <p className="text-sm text-slate-400">
          8 рабочих диаграмм на реальных данных выбранного периода.
        </p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Chart title="Продажи и клиентские оплаты">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={monthly}>
              <Grid />
              <XAxis dataKey="month" />
              <YAxis width={72} />
              <Tooltip formatter={chartMoney} />
              <Legend />
              <Bar dataKey="sales" name="Продажи" fill="#fbbf24" />
              <Line
                dataKey="received"
                name="Получено"
                stroke="#34d399"
                strokeWidth={3}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Начислено и выплачено партнёрам">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={monthly}>
              <Grid />
              <XAxis dataKey="month" />
              <YAxis width={72} />
              <Tooltip formatter={chartMoney} />
              <Legend />
              <Bar dataKey="partnerAccrued" name="Начислено" fill="#f59e0b" />
              <Bar dataKey="partnerPaid" name="Выплачено" fill="#22c55e" />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Остатки клиентов и долги партнёрам">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthly}>
              <Grid />
              <XAxis dataKey="month" />
              <YAxis width={72} />
              <Tooltip formatter={chartMoney} />
              <Legend />
              <Line
                dataKey="clientOutstanding"
                name="Остаток клиентов"
                stroke="#38bdf8"
                strokeWidth={3}
              />
              <Line
                dataKey="partnerPayable"
                name="Долг партнёрам"
                stroke="#fb7185"
                strokeWidth={3}
              />
            </LineChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Чистая прибыль по месяцам">
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={monthly}>
              <Grid />
              <XAxis dataKey="month" />
              <YAxis width={72} />
              <Tooltip formatter={chartMoney} />
              <Legend />
              <Area
                dataKey="netProfit"
                name="Чистая прибыль"
                stroke="#34d399"
                fill="#34d39933"
                strokeWidth={3}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Чистая маржа по месяцам">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={monthly}>
              <Grid />
              <XAxis dataKey="month" />
              <YAxis width={72} unit="%" />
              <Tooltip
                formatter={(value) =>
                  `${Number(value).toLocaleString("ru-RU")}%`
                }
              />
              <Legend />
              <Line
                dataKey="netMargin"
                name="Чистая маржа"
                stroke="#c084fc"
                strokeWidth={3}
              />
            </LineChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Прибыль по партнёрам">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={partners} layout="vertical">
              <Grid />
              <XAxis type="number" />
              <YAxis type="category" dataKey="name" width={110} />
              <Tooltip formatter={chartMoney} />
              <Legend />
              <Bar dataKey="profit" name="Чистая прибыль" fill="#34d399" />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Количество заказов по партнёрам">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={partners}>
              <Grid />
              <XAxis dataKey="name" hide />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="orders" name="Заказы" fill="#38bdf8" />
            </BarChart>
          </ResponsiveContainer>
        </Chart>
        <Chart title="Структура расходов партнёрских заказов">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={expenses}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={3}
              >
                {expenses.map((item) => (
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Pie>
              <Tooltip formatter={chartMoney} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Chart>
      </div>
    </section>
  );
}

function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={`${panel} min-w-0`}>
      <h3 className="mb-4 font-bold text-white">{title}</h3>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
const Grid = () => <CartesianGrid stroke="#334155" strokeDasharray="3 3" />;
const chartMoney = (value: unknown) => money(Number(value));

function Orders({
  data,
  filters,
  setFilters,
  queryDraft,
  setQueryDraft,
  applyQuery,
  onAgreement,
  onPayout,
  onAdjustment,
  onHistory,
}: {
  data: Payload;
  filters: typeof initialFilters;
  setFilters: React.Dispatch<React.SetStateAction<typeof initialFilters>>;
  queryDraft: string;
  setQueryDraft: (value: string) => void;
  applyQuery: () => void;
  onAgreement: (order: PartnerOrder) => void;
  onPayout: (order: PartnerOrder) => void;
  onAdjustment: (order: PartnerOrder) => void;
  onHistory: (order: PartnerOrder) => void;
}) {
  return (
    <div className="space-y-4">
      <section className={panel}>
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={18} className="text-amber-300" />
          <h2 className="text-lg font-bold">Фильтры заказов</h2>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-sm text-slate-400 xl:col-span-2">
            <span>
              Поиск по заказу, договору, клиенту, телефону, городу, партнёру или
              адресу
            </span>
            <div className="mt-1 flex gap-2">
              <input
                className={field}
                value={queryDraft}
                onChange={(event) => setQueryDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyQuery();
                }}
              />
              <button
                type="button"
                className={secondary}
                onClick={applyQuery}
                aria-label="Найти"
              >
                <Search size={17} />
              </button>
            </div>
          </label>
          <Select
            label="Основные"
            value={filters.scope}
            onChange={(scope) =>
              setFilters((current) => ({ ...current, scope, page: 1 }))
            }
            options={scopeOptions}
          />
          <Select
            label="Оплата клиента"
            value={filters.clientStatus}
            onChange={(clientStatus) =>
              setFilters((current) => ({ ...current, clientStatus, page: 1 }))
            }
            options={clientOptions}
          />
          <Select
            label="Расчёт с партнёром"
            value={filters.partnerStatus}
            onChange={(partnerStatus) =>
              setFilters((current) => ({ ...current, partnerStatus, page: 1 }))
            }
            options={partnerStatusOptions}
          />
          <Select
            label="Прибыль"
            value={filters.profit}
            onChange={(profit) =>
              setFilters((current) => ({ ...current, profit, page: 1 }))
            }
            options={profitOptions}
          />
          <Select
            label="Партнёр"
            value={filters.partnerId}
            onChange={(partnerId) =>
              setFilters((current) => ({ ...current, partnerId, page: 1 }))
            }
            options={[
              ["", "Все партнёры"],
              ...data.partners.map(
                (item) => [String(item.id), item.name] as [string, string],
              ),
            ]}
          />
          <Select
            label="Сортировка"
            value={filters.sort}
            onChange={(sort) =>
              setFilters((current) => ({ ...current, sort, page: 1 }))
            }
            options={sortOptions}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
          <Quick
            label={`Все активные · ${data.counts.active}`}
            action={() =>
              setFilters((current) => ({
                ...current,
                ...initialFilters,
                period: current.period,
              }))
            }
          />
          <Quick
            label={`С партнёром · ${data.counts.withPartner}`}
            action={() =>
              setFilters((current) => ({
                ...current,
                scope: "with_partner",
                page: 1,
              }))
            }
          />
          <Quick
            label={`Без партнёра · ${data.counts.withoutPartner}`}
            action={() =>
              setFilters((current) => ({
                ...current,
                scope: "without_partner",
                page: 1,
              }))
            }
          />
          <Quick
            label={`Без стоимости · ${data.counts.withoutCost}`}
            action={() =>
              setFilters((current) => ({
                ...current,
                scope: "without_cost",
                page: 1,
              }))
            }
          />
        </div>
      </section>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Канонические заказы</h2>
          <p className="text-sm text-slate-400">
            Найдено {data.pagination.total}. Все активные в компании:{" "}
            {data.counts.active}.
          </p>
        </div>
        <p className="text-sm text-slate-400">
          Итого продажи {money(data.allFilteredTotals.orderAmount)} · чистая
          прибыль {money(data.allFilteredTotals.profit)}
        </p>
      </div>
      <OrderTable
        orders={data.orders}
        onAgreement={onAgreement}
        onPayout={onPayout}
        onAdjustment={onAdjustment}
        onHistory={onHistory}
      />
      <Pagination
        pagination={data.pagination}
        page={(value) => setFilters((current) => ({ ...current, page: value }))}
      />
    </div>
  );
}

function OrderTable({
  orders,
  onAgreement,
  onPayout,
  onAdjustment,
  onHistory,
}: {
  orders: PartnerOrder[];
  onAgreement: (order: PartnerOrder) => void;
  onPayout: (order: PartnerOrder) => void;
  onAdjustment: (order: PartnerOrder) => void;
  onHistory: (order: PartnerOrder) => void;
}) {
  if (!orders.length) return <Empty />;
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto rounded-2xl border border-white/10 md:block">
        <table className="min-w-[2600px] w-full border-collapse bg-[#0b1220] text-sm">
          <thead className="sticky top-0 z-10 bg-slate-950 text-left text-xs uppercase tracking-wide text-slate-400">
            <tr>
              {[
                "Заказ / дата",
                "Клиент",
                "Город / адрес",
                "Партнёр / цех",
                "Продажа",
                "Клиент оплатил",
                "Остаток клиента",
                "Согласовано",
                "Начислено",
                "Выплачено",
                "Осталось партнёру",
                "Прямые расходы",
                "Маржа до зарплаты",
                "Зарплата",
                "Чистая прибыль",
                "Чистая маржа",
                "Этап",
                "Оплата клиента",
                "Расчёт партнёра",
                "Действия",
              ].map((label) => (
                <th key={label} className="border-b border-slate-800 px-3 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((item) => (
              <tr
                key={item.order.id}
                className="border-b border-slate-800/70 align-top hover:bg-slate-900/50"
              >
                <td className="px-3 py-3">
                  <a
                    className="font-bold text-amber-300 hover:underline"
                    href={`/orders/${item.order.id}`}
                  >
                    {item.order.number}
                  </a>
                  <p className="mt-1 text-xs text-slate-500">
                    {day(item.order.orderReceivedAt)}
                  </p>
                  {item.order.contract?.number && (
                    <p className="text-xs text-slate-500">
                      {item.order.contract.number}
                    </p>
                  )}
                </td>
                <td className="px-3 py-3">
                  <a
                    className="font-semibold text-white hover:underline"
                    href={`/clients/${item.order.client.id}`}
                  >
                    {item.order.client.name || "Клиент не указан"}
                  </a>
                  <p className="mt-1 text-xs text-slate-400">
                    {item.order.client.phone}
                  </p>
                </td>
                <td className="max-w-64 px-3 py-3">
                  <p>{item.order.client.city || "—"}</p>
                  <p className="mt-1 break-words text-xs text-slate-500">
                    {item.order.address}
                  </p>
                </td>
                <td className="px-3 py-3">
                  {item.partner ? (
                    <button
                      type="button"
                      className="font-semibold text-white hover:text-amber-300"
                    >
                      {item.partner.name}
                    </button>
                  ) : (
                    <span className="text-amber-200">Партнёр не назначен</span>
                  )}
                </td>
                <MoneyCell value={item.economy.client.totalSale} />
                <MoneyCell value={item.economy.client.netReceived} />
                <MoneyCell
                  value={item.economy.client.remaining}
                  danger={number(item.economy.client.remaining) > 0}
                />
                <MoneyCell
                  value={item.economy.partner.agreed}
                  missing={!item.economy.partner.agreedAt}
                />
                <MoneyCell
                  value={item.economy.partner.accrued}
                  missing={!item.economy.partner.agreedAt}
                />
                <MoneyCell value={item.economy.partner.paid} />
                <MoneyCell
                  value={item.economy.partner.remaining}
                  danger={number(item.economy.partner.remaining) > 0}
                />
                <MoneyCell value={item.economy.profit.directExpenses} />
                <MoneyCell
                  value={item.economy.profit.marginBeforePayroll}
                  missing={!item.economy.profit.complete}
                />
                <MoneyCell value={item.economy.profit.payrollAccrued} />
                <MoneyCell
                  value={item.economy.profit.netProfit}
                  missing={!item.economy.profit.complete}
                />
                <td className="px-3 py-3 font-semibold">
                  {item.economy.profit.complete &&
                  number(item.economy.client.totalSale) !== 0
                    ? percent(item.economy.profit.netMarginPercent)
                    : "—"}
                </td>
                <td className="px-3 py-3">
                  <Status value={item.order.lifecycle} />
                </td>
                <td className="px-3 py-3">
                  <Status value={item.economy.client.status} />
                </td>
                <td className="px-3 py-3">
                  <Status value={item.economy.partner.status} />
                </td>
                <td className="px-3 py-3">
                  <RowActions
                    item={item}
                    onAgreement={onAgreement}
                    onPayout={onPayout}
                    onAdjustment={onAdjustment}
                    onHistory={onHistory}
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-950 font-bold text-white">
            <tr>
              <td className="px-3 py-3" colSpan={4}>
                Итого по фильтру
              </td>
              <td className="px-3 py-3">
                {money(
                  orders.reduce(
                    (sum, item) => sum + number(item.economy.client.totalSale),
                    0,
                  ),
                )}
              </td>
              <td colSpan={15} />
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="grid gap-4 md:hidden">
        {orders.map((item) => (
          <OrderCard
            key={item.order.id}
            item={item}
            onAgreement={onAgreement}
            onPayout={onPayout}
            onAdjustment={onAdjustment}
            onHistory={onHistory}
          />
        ))}
      </div>
    </>
  );
}

function MoneyCell({
  value,
  danger: alert,
  missing,
}: {
  value: DecimalLike;
  danger?: boolean;
  missing?: boolean;
}) {
  return (
    <td
      className={`whitespace-nowrap px-3 py-3 font-semibold ${alert ? "text-red-300" : "text-slate-200"}`}
    >
      {missing ? (
        <span className="text-amber-200">Не указано</span>
      ) : (
        money(value)
      )}
    </td>
  );
}

function OrderCard({
  item,
  onAgreement,
  onPayout,
  onAdjustment,
  onHistory,
}: {
  item: PartnerOrder;
  onAgreement: (order: PartnerOrder) => void;
  onPayout: (order: PartnerOrder) => void;
  onAdjustment: (order: PartnerOrder) => void;
  onHistory: (order: PartnerOrder) => void;
}) {
  return (
    <article className={panel}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            className="font-bold text-amber-300"
            href={`/orders/${item.order.id}`}
          >
            {item.order.number}
          </a>
          <p className="mt-1 break-words text-sm text-white">
            {item.order.client.name || "Клиент не указан"}
          </p>
          <p className="text-xs text-slate-400">
            {item.order.client.phone} ·{" "}
            {item.order.client.city || "город не указан"}
          </p>
        </div>
        <Status value={item.order.lifecycle} />
      </div>
      <p className="mt-3 text-sm text-slate-300">
        {item.partner?.name ?? "Партнёр не назначен"}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Mini
          label="Сумма продажи"
          value={money(item.economy.client.totalSale)}
        />
        <Mini
          label="Оплачено клиентом"
          value={money(item.economy.client.netReceived)}
        />
        <Mini
          label="Остаток клиента"
          value={money(item.economy.client.remaining)}
        />
        <Mini
          label="Стоимость партнёра"
          value={
            item.economy.partner.agreedAt
              ? money(item.economy.partner.agreed)
              : "Не указана"
          }
        />
        <Mini
          label="Выплачено партнёру"
          value={money(item.economy.partner.paid)}
        />
        <Mini
          label="Осталось партнёру"
          value={money(item.economy.partner.remaining)}
        />
        <Mini
          label="Маржа до зарплаты"
          value={
            item.economy.profit.complete
              ? money(item.economy.profit.marginBeforePayroll)
              : "—"
          }
        />
        <Mini
          label="Зарплата"
          value={money(item.economy.profit.payrollAccrued)}
        />
        <Mini
          label={
            item.economy.profit.mode === "ACTUAL"
              ? "Фактическая прибыль"
              : "Плановая прибыль"
          }
          value={
            item.economy.profit.complete
              ? money(item.economy.profit.netProfit)
              : "—"
          }
        />
        <Mini
          label="Чистая маржа"
          value={
            item.economy.profit.complete &&
            number(item.economy.client.totalSale) !== 0
              ? percent(item.economy.profit.netMarginPercent)
              : "—"
          }
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Status value={item.economy.client.status} />
        <Status value={item.economy.partner.status} />
      </div>
      {item.economy.profit.warning && (
        <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-950/30 p-3 text-xs text-amber-100">
          {item.economy.profit.warning}
        </p>
      )}
      <details className="mt-3 rounded-xl bg-slate-950 p-3">
        <summary className="cursor-pointer font-semibold">
          Экономика и движение денег
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Mini
            label="Другие прямые расходы"
            value={money(item.economy.profit.directExpenses)}
          />
          <Mini
            label="Денежный остаток"
            value={money(item.economy.cash.balance)}
          />
          <Mini
            label="Оплачено расходов"
            value={money(item.economy.cash.otherExpensesPaid)}
          />
          <Mini
            label="Выплачено зарплаты"
            value={money(item.economy.cash.payrollPaid)}
          />
        </div>
      </details>
      <div className="mt-4">
        <RowActions
          item={item}
          onAgreement={onAgreement}
          onPayout={onPayout}
          onAdjustment={onAdjustment}
          onHistory={onHistory}
        />
      </div>
    </article>
  );
}

function RowActions({
  item,
  onAgreement,
  onPayout,
  onAdjustment,
  onHistory,
}: {
  item: PartnerOrder;
  onAgreement: (order: PartnerOrder) => void;
  onPayout: (order: PartnerOrder) => void;
  onAdjustment: (order: PartnerOrder) => void;
  onHistory: (order: PartnerOrder) => void;
}) {
  const canPay = Boolean(
    item.partnerId &&
    item.economy.partner.agreedAt &&
    number(item.economy.partner.remaining) > 0,
  );
  return (
    <div className="flex min-w-52 flex-col gap-2">
      <a href={`/orders/${item.order.id}`} className={secondary}>
        <ExternalLink size={15} />
        Открыть заказ
      </a>
      <button
        type="button"
        className={secondary}
        onClick={() => onAgreement(item)}
      >
        <Link2 size={15} />
        {item.partnerId
          ? item.economy.partner.agreedAt
            ? "Изменить стоимость"
            : "Указать стоимость"
          : "Передать существующий заказ в цех"}
      </button>
      {canPay ? (
        <button
          type="button"
          className={primary}
          onClick={() => onPayout(item)}
        >
          <HandCoins size={15} />
          {number(item.economy.partner.paid) > 0
            ? "Оплатить остаток"
            : "Выплатить партнёру"}
        </button>
      ) : item.economy.partner.status === "PAID" ? (
        <Status value="PAID" />
      ) : (
        <span className="text-xs text-slate-500">
          {!item.partnerId
            ? "Сначала назначьте партнёра"
            : !item.economy.partner.agreedAt
              ? "Сначала укажите стоимость"
              : "Нет остатка к выплате"}
        </span>
      )}
      {item.relationId && (
        <button
          type="button"
          className={secondary}
          onClick={() => onAdjustment(item)}
        >
          Добавить работу / корректировку
        </button>
      )}
      <a href={`/orders/${item.order.id}`} className={secondary}>
        <Wallet size={15} />
        Принять оплату клиента
      </a>
      <button
        type="button"
        className={secondary}
        onClick={() => onHistory(item)}
      >
        <History size={15} />
        История
      </button>
      {item.partnerId && (
        <a
          className={secondary}
          href={`/api/partner-management/${item.partnerId}/statement?format=pdf`}
        >
          <Download size={15} />
          Выписка
        </a>
      )}
    </div>
  );
}

function Pagination({
  pagination,
  page,
}: {
  pagination: Payload["pagination"];
  page: (value: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3 text-sm">
      <span>
        Страница {pagination.page} из {pagination.pages}
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          className={secondary}
          disabled={pagination.page <= 1}
          onClick={() => page(pagination.page - 1)}
          aria-label="Предыдущая страница"
        >
          <ChevronLeft size={17} />
        </button>
        <button
          type="button"
          className={secondary}
          disabled={pagination.page >= pagination.pages}
          onClick={() => page(pagination.page + 1)}
          aria-label="Следующая страница"
        >
          <ChevronRight size={17} />
        </button>
      </div>
    </div>
  );
}

function Partners({
  data,
  busy,
  mutate,
}: {
  data: Payload;
  busy: boolean;
  mutate: (
    body: Record<string, unknown>,
    idempotent?: boolean,
  ) => Promise<boolean>;
}) {
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState({
    name: "",
    kind: "CONTRACTOR",
    phone: "",
    secondaryPhone: "",
    email: "",
    city: "",
    address: "",
    contactPerson: "",
    cooperationStartedAt: "",
    rewardRule: "MANUAL",
    rewardPercent: "",
    fixedAmount: "",
    comment: "",
  });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (await mutate({ action: "create-partner", ...form })) {
      setCreating(false);
      setForm((current) => ({
        ...current,
        name: "",
        phone: "",
        secondaryPhone: "",
        email: "",
        comment: "",
      }));
    }
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-xl font-bold">Партнёры и цеха</h2>
          <p className="text-sm text-slate-400">
            Включены справочник и партнёры, уже связанные с реальными заказами.
          </p>
        </div>
        <button
          type="button"
          className={primary}
          onClick={() => setCreating((value) => !value)}
        >
          <Plus size={17} />
          Добавить партнёра
        </button>
      </div>
      {creating && (
        <form
          onSubmit={submit}
          className={`${panel} grid gap-3 md:grid-cols-2 xl:grid-cols-3`}
        >
          <FormTitle>Новый партнёр</FormTitle>
          <Input
            required
            label="Название / ФИО"
            value={form.name}
            onChange={(name) => setForm({ ...form, name })}
          />
          <Select
            label="Тип"
            value={form.kind}
            onChange={(kind) => setForm({ ...form, kind })}
            options={partnerKinds}
          />
          <Input
            label="Телефон"
            value={form.phone}
            onChange={(phone) => setForm({ ...form, phone })}
          />
          <Input
            label="Дополнительный телефон"
            value={form.secondaryPhone}
            onChange={(secondaryPhone) => setForm({ ...form, secondaryPhone })}
          />
          <Input
            label="Email"
            type="email"
            value={form.email}
            onChange={(email) => setForm({ ...form, email })}
          />
          <Input
            label="Город"
            value={form.city}
            onChange={(city) => setForm({ ...form, city })}
          />
          <Input
            label="Адрес"
            value={form.address}
            onChange={(address) => setForm({ ...form, address })}
          />
          <Input
            label="Контактное лицо"
            value={form.contactPerson}
            onChange={(contactPerson) => setForm({ ...form, contactPerson })}
          />
          <Input
            label="Дата начала"
            type="date"
            value={form.cooperationStartedAt}
            onChange={(cooperationStartedAt) =>
              setForm({ ...form, cooperationStartedAt })
            }
          />
          <Select
            label="Правило расчёта"
            value={form.rewardRule}
            onChange={(rewardRule) => setForm({ ...form, rewardRule })}
            options={rewardRules}
          />
          <Input
            label="Комментарий"
            value={form.comment}
            onChange={(comment) => setForm({ ...form, comment })}
          />
          <div className="flex items-end gap-2">
            <button disabled={busy} className={primary}>
              Сохранить
            </button>
            <button
              type="button"
              className={secondary}
              onClick={() => setCreating(false)}
            >
              Отмена
            </button>
          </div>
        </form>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {data.partners.map((partner) => (
          <article key={partner.id} className={panel}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-white">{partner.name}</h3>
                <p className="text-sm text-slate-400">
                  {kindLabel(partner.kind)} ·{" "}
                  {partner.city || "город не указан"}
                </p>
              </div>
              <Status value={partner.businessStatus} />
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Mini label="Заказов" value={String(partner.totals.orders)} />
              <Mini label="Продажи" value={money(partner.totals.orderAmount)} />
              <Mini
                label="Осталось выплатить"
                value={money(partner.totals.companyDebt)}
              />
              <Mini
                label="Чистая прибыль"
                value={money(partner.totals.profit)}
              />
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                className={secondary}
                onClick={() =>
                  setSelected(selected === partner.id ? null : partner.id)
                }
              >
                Карточка партнёра
              </button>
              <button
                type="button"
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void mutate({
                    action: "update-partner",
                    partnerId: partner.id,
                    businessStatus:
                      partner.businessStatus === "ARCHIVED"
                        ? "ACTIVE"
                        : "ARCHIVED",
                  })
                }
              >
                {partner.businessStatus === "ARCHIVED"
                  ? "Активировать"
                  : "В архив"}
              </button>
            </div>
            {selected === partner.id && (
              <PartnerDetails
                partner={partner}
                orders={data.orders.filter(
                  (order) => order.partnerId === partner.id,
                )}
                operations={data.operations.filter(
                  (operation) => operation.partnerName === partner.name,
                )}
                audits={data.audits.filter(
                  (event) => event.partnerId === partner.id,
                )}
              />
            )}
          </article>
        ))}
        {!data.partners.length && <Empty />}
      </div>
    </div>
  );
}

function PartnerDetails({
  partner,
  orders,
  operations,
  audits,
}: {
  partner: Partner;
  orders: PartnerOrder[];
  operations: Operation[];
  audits: Payload["audits"];
}) {
  return (
    <div className="mt-5 space-y-5 border-t border-white/10 pt-5 text-sm">
      <section>
        <h4 className="font-bold">Основные данные</h4>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <p>
            Телефон: <b>{partner.phone || "—"}</b>
          </p>
          <p>
            Город: <b>{partner.city || "—"}</b>
          </p>
          <p>
            Начало: <b>{day(partner.cooperationStartedAt)}</b>
          </p>
          <p>
            Правило: <b>{rewardLabel(partner.defaultRewardRule)}</b>
          </p>
        </div>
      </section>
      <section>
        <h4 className="font-bold">Общий результат</h4>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Mini
            label="Получено от клиентов"
            value={money(partner.totals.received)}
          />
          <Mini
            label="Остаток клиентов"
            value={money(partner.totals.clientRemaining)}
          />
          <Mini
            label="Начислено"
            value={money(partner.totals.partnerAccrued)}
          />
          <Mini label="Выплачено" value={money(partner.totals.partnerPaid)} />
          <Mini
            label="Маржа до зарплаты"
            value={money(partner.totals.marginBeforePayroll)}
          />
          <Mini label="Зарплата" value={money(partner.totals.payroll)} />
          <Mini
            label="Средняя маржа"
            value={percent(partner.totals.averageMargin)}
          />
          <Mini
            label="Средний срок"
            value={
              partner.averageExecutionDays == null
                ? "—"
                : `${partner.averageExecutionDays} дн.`
            }
          />
          <Mini label="Просрочено" value={String(partner.overdueObligations)} />
        </div>
      </section>
      <details open>
        <summary className="cursor-pointer font-bold">Заказы</summary>
        <div className="mt-2 space-y-2">
          {orders.map((order) => (
            <a
              key={order.order.id}
              href={`/orders/${order.order.id}`}
              className="block rounded-xl bg-slate-950 p-3 hover:text-amber-300"
            >
              {order.order.number} · {order.order.client.name} ·{" "}
              {money(order.metrics.orderAmount)}
            </a>
          ))}
          {!orders.length && <Empty />}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-bold">Взаиморасчёты</summary>
        <div className="mt-2 space-y-2">
          {operations.map((operation) => (
            <p key={operation.id} className="rounded-xl bg-slate-950 p-3">
              {day(operation.operationDate)} · {operation.orderNumber} ·{" "}
              {operationLabel(operation.type)} · {money(operation.amount)} ·{" "}
              {operation.account || operation.method || "—"} ·{" "}
              {operation.createdBy?.name || "Система"}
            </p>
          ))}
          {!operations.length && <Empty />}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-bold">Документы</summary>
        <div className="mt-2 space-y-2">
          {partner.documents.map((document) => (
            <p key={document.id} className="rounded-xl bg-slate-950 p-3">
              {document.number || document.title} · {document.type}
            </p>
          ))}
          {!partner.documents.length && <Empty />}
        </div>
      </details>
      <details>
        <summary className="cursor-pointer font-bold">История</summary>
        <div className="mt-2 space-y-2">
          {audits.map((event) => (
            <p
              key={event.id}
              className="rounded-xl bg-slate-950 p-3 text-slate-400"
            >
              {day(event.createdAt)} · {event.action} ·{" "}
              {event.actor?.name || "Система"}
              {event.comment ? ` · ${event.comment}` : ""}
            </p>
          ))}
          {!audits.length && <Empty />}
        </div>
      </details>
    </div>
  );
}

function Settlements({
  data,
  busy,
  mutate,
  onPayout,
  onAdjustment,
}: {
  data: Payload;
  busy: boolean;
  mutate: (
    body: Record<string, unknown>,
    idempotent?: boolean,
  ) => Promise<boolean>;
  onPayout: (order: PartnerOrder) => void;
  onAdjustment: (order: PartnerOrder) => void;
}) {
  const rows = [...data.orders]
    .filter((item) => item.partnerId)
    .sort(
      (left, right) =>
        number(right.metrics.partnerBalance) -
        number(left.metrics.partnerBalance),
    );
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Взаиморасчёты</h2>
        <p className="text-sm text-slate-400">
          Согласовано, начислено, фактически выплачено и остаток — отдельные
          показатели.
        </p>
      </div>
      {rows.map((item) => (
        <article key={item.order.id} className={panel}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <a
                href={`/orders/${item.order.id}`}
                className="font-bold text-amber-300"
              >
                {item.order.number}
              </a>
              <p className="text-sm text-slate-400">
                {item.order.client.name} · {item.partner?.name}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Status value={item.economy.partner.status} />
              <Status value={item.order.lifecycle} />
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
            <Mini
              label="Согласованная стоимость"
              value={
                item.economy.partner.agreedAt
                  ? money(item.economy.partner.agreed)
                  : "Не указана"
              }
            />
            <Mini
              label="Начислено партнёру"
              value={money(item.economy.partner.accrued)}
            />
            <Mini
              label="Фактически выплачено"
              value={money(item.economy.partner.paid)}
            />
            <Mini
              label="Осталось выплатить"
              value={money(item.economy.partner.remaining)}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {number(item.economy.partner.remaining) > 0 &&
              item.economy.partner.agreedAt && (
                <button
                  type="button"
                  className={primary}
                  onClick={() => onPayout(item)}
                >
                  <HandCoins size={16} />
                  Выплатить
                </button>
              )}
            {item.relationId && (
              <button
                type="button"
                className={secondary}
                onClick={() => onAdjustment(item)}
              >
                Корректировка
              </button>
            )}
            {item.relationId && (
              <button
                type="button"
                disabled={busy}
                className={secondary}
                onClick={() => {
                  const reason = window.prompt(
                    "Обязательная причина спорного расчёта",
                  );
                  if (reason?.trim())
                    void mutate({
                      action: "settlement-state",
                      relationId: item.relationId,
                      state: "DISPUTE",
                      comment: reason,
                    });
                }}
              >
                Отметить спорным
              </button>
            )}
            {item.relationId && number(item.metrics.partnerBalance) === 0 && (
              <button
                type="button"
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void mutate({
                    action: "settlement-state",
                    relationId: item.relationId,
                    state: "CLOSE",
                    comment: "Взаиморасчёт закрыт директором",
                  })
                }
              >
                Закрыть
              </button>
            )}
          </div>
          {item.disputeReason && (
            <p className="mt-3 rounded-xl border border-red-500/30 bg-red-950/30 p-3 text-sm text-red-200">
              Причина спора: {item.disputeReason}
            </p>
          )}
        </article>
      ))}
      {!rows.length && <Empty />}
    </div>
  );
}

function Payments({
  data,
  busy,
  mutate,
  onHistorical,
}: {
  data: Payload;
  busy: boolean;
  mutate: (
    body: Record<string, unknown>,
    idempotent?: boolean,
  ) => Promise<boolean>;
  onHistorical: (payment: Payload["unallocatedOperations"][number]) => void;
}) {
  return (
    <div className="space-y-5">
      <section>
        <h2 className="text-xl font-bold">Выплаты партнёрам</h2>
        <p className="text-sm text-slate-400">
          Журнал канонических операций. Новая выплата проводится из строки
          конкретного заказа.
        </p>
        <div className="mt-4 space-y-3">
          {data.operations.map((operation) => (
            <div
              key={operation.id}
              className={`${panel} flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between`}
            >
              <div>
                <p className="font-semibold">
                  {operationLabel(operation.type)} · {money(operation.amount)}
                </p>
                <p className="text-sm text-slate-400">
                  {day(operation.operationDate)} · {operation.orderNumber} ·{" "}
                  {operation.partnerName} ·{" "}
                  {operation.account || operation.method || "—"} ·{" "}
                  {operation.createdBy?.name || "Система"}
                </p>
                {operation.comment && (
                  <p className="mt-1 text-xs text-slate-500">
                    {operation.comment}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Status value={operation.status} />
                {operation.status === "POSTED" &&
                  operation.type !== "REVERSAL" && (
                    <button
                      type="button"
                      className={danger}
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          "Обязательная причина сторно",
                        );
                        if (reason?.trim())
                          void mutate(
                            {
                              action: "reverse-operation",
                              operationId: operation.id,
                              reason,
                            },
                            true,
                          );
                      }}
                    >
                      <RotateCcw size={16} />
                      Сторно
                    </button>
                  )}
              </div>
            </div>
          ))}
          {!data.operations.length && <Empty />}
        </div>
      </section>
      <section className={panel}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="text-amber-300" size={19} />
          <h2 className="text-lg font-bold">
            Неразнесённые партнёрские операции
          </h2>
        </div>
        <p className="mt-1 text-sm text-slate-400">
          Не связываются автоматически. Привязка не создаёт новую денежную
          операцию.
        </p>
        <div className="mt-4 space-y-3">
          {data.unallocatedOperations.map((payment) => (
            <div
              key={payment.id}
              className="flex flex-col gap-3 rounded-xl bg-slate-950 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="font-semibold">
                  {day(payment.operationDate)} · {money(payment.amount)} ·{" "}
                  {payment.counterparty}
                </p>
                <p className="text-sm text-slate-500">
                  {payment.orderNumber || "Заказ не указан"} ·{" "}
                  {payment.account || "счёт не указан"} · {payment.author}
                  {payment.comment ? ` · ${payment.comment}` : ""}
                </p>
              </div>
              <button
                type="button"
                className={secondary}
                onClick={() => onHistorical(payment)}
              >
                Привязать к заказу
              </button>
            </div>
          ))}
          {!data.unallocatedOperations.length && (
            <p className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 text-sm text-emerald-200">
              Все партнёрские выплаты разнесены.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}

function Reports({ data }: { data: Payload }) {
  const [partnerId, setPartnerId] = useState(
    data.partners[0] ? String(data.partners[0].id) : "",
  );
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useMemo(
    () =>
      new URLSearchParams({
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      }).toString(),
    [from, to],
  );
  return (
    <div className="space-y-5">
      <section className={`${panel} grid gap-3 md:grid-cols-2 xl:grid-cols-4`}>
        <FormTitle>Выписка по партнёру</FormTitle>
        <Select
          label="Партнёр"
          value={partnerId}
          onChange={setPartnerId}
          options={data.partners.map((item) => [String(item.id), item.name])}
        />
        <Input label="С" type="date" value={from} onChange={setFrom} />
        <Input label="По" type="date" value={to} onChange={setTo} />
        <div className="flex items-end gap-2">
          <a
            className={primary}
            href={`/api/partner-management/${partnerId}/statement?format=pdf&${query}`}
          >
            <Download size={17} />
            PDF
          </a>
          <a
            className={secondary}
            href={`/api/partner-management/${partnerId}/statement?format=csv&${query}`}
          >
            <Download size={17} />
            CSV
          </a>
        </div>
      </section>
      <AnalyticsCharts data={data} />
    </div>
  );
}

function AgreementDialog({
  order,
  partners,
  busy,
  close,
  submit,
}: {
  order: PartnerOrder;
  partners: Partner[];
  busy: boolean;
  close: () => void;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    partnerId: order.partnerId ? String(order.partnerId) : "",
    amount: order.economy.partner.agreedAt
      ? String(order.economy.partner.agreed)
      : "",
    agreedAt:
      inputDate(order.economy.partner.agreedAt) ||
      new Date().toISOString().slice(0, 10),
    workDueAt: inputDate(order.workDueAt),
    paymentDueAt: inputDate(order.paymentDueAt),
    comment: "",
  });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (form.amount)
      await submit({
        action: "set-order-agreement",
        orderId: order.order.id,
        ...form,
        partnerId: Number(form.partnerId),
      });
    else
      await submit({
        action: "link-order",
        orderId: order.order.id,
        rewardRule: "MANUAL",
        ...form,
        partnerId: Number(form.partnerId),
      });
  };
  return (
    <Dialog
      title={
        order.partnerId
          ? "Партнёр и согласованная стоимость"
          : "Назначить партнёра"
      }
      close={close}
    >
      <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
        <Select
          required
          label="Партнёр / цех"
          value={form.partnerId}
          onChange={(partnerId) => setForm({ ...form, partnerId })}
          options={partners
            .filter(
              (partner) =>
                partner.businessStatus === "ACTIVE" &&
                partner.active &&
                !partner.archived,
            )
            .map((partner) => [String(partner.id), partner.name])}
        />
        <Input
          label="Согласованная сумма, ₸ (можно указать позже)"
          type="number"
          value={form.amount}
          onChange={(amount) => setForm({ ...form, amount })}
        />
        <Input
          label="Дата согласования"
          type="date"
          value={form.agreedAt}
          onChange={(agreedAt) => setForm({ ...form, agreedAt })}
        />
        <Input
          label="Срок выполнения"
          type="date"
          value={form.workDueAt}
          onChange={(workDueAt) => setForm({ ...form, workDueAt })}
        />
        <Input
          label="Срок выплаты"
          type="date"
          value={form.paymentDueAt}
          onChange={(paymentDueAt) => setForm({ ...form, paymentDueAt })}
        />
        <Input
          label="Комментарий / причина изменения"
          value={form.comment}
          onChange={(comment) => setForm({ ...form, comment })}
        />
        <p className="md:col-span-2 rounded-xl border border-sky-500/20 bg-sky-950/30 p-3 text-sm text-sky-100">
          Указание стоимости создаёт обязательство и audit log, но не создаёт
          расход Finance и не уменьшает кассу.
        </p>
        <DialogButtons
          busy={busy}
          close={close}
          label={
            form.amount ? "Сохранить стоимость" : "Назначить без стоимости"
          }
        />
      </form>
    </Dialog>
  );
}

function PayoutDialog({
  order,
  busy,
  close,
  submit,
}: {
  order: PartnerOrder;
  busy: boolean;
  close: () => void;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const remaining = number(order.economy.partner.remaining);
  const [form, setForm] = useState({
    payoutType: "full",
    amount: String(remaining),
    operationDate: new Date().toISOString().slice(0, 10),
    account: "Касса / банковский счёт",
    method: "Банковский перевод",
    purpose: `Выплата по заказу ${order.order.number}`,
    comment: "",
  });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submit({
      action: "partner-payout",
      orderId: order.order.id,
      amount: form.amount,
      operationDate: form.operationDate,
      account: form.account,
      method: form.method,
      comment: [form.purpose, form.comment].filter(Boolean).join(" · "),
    });
  };
  return (
    <Dialog title="Выплатить партнёру" close={close}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Mini label="Заказ" value={order.order.number} />
          <Mini label="Клиент" value={order.order.client.name} />
          <Mini label="Партнёр" value={order.partner?.name || "—"} />
          <Mini label="Продажа" value={money(order.economy.client.totalSale)} />
          <Mini
            label="Согласовано"
            value={money(order.economy.partner.agreed)}
          />
          <Mini
            label="Начислено"
            value={money(order.economy.partner.accrued)}
          />
          <Mini
            label="Ранее выплачено"
            value={money(order.economy.partner.paid)}
          />
          <Mini
            label="Осталось"
            value={money(order.economy.partner.remaining)}
          />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Select
            label="Тип выплаты"
            value={form.payoutType}
            onChange={(payoutType) =>
              setForm({
                ...form,
                payoutType,
                amount: payoutType === "full" ? String(remaining) : form.amount,
              })
            }
            options={[
              ["partial", "Частичная"],
              ["full", "Полный остаток"],
            ]}
          />
          <Input
            required
            label="Сумма"
            type="number"
            value={form.amount}
            onChange={(amount) => setForm({ ...form, amount })}
          />
          <Input
            required
            label="Дата"
            type="date"
            value={form.operationDate}
            onChange={(operationDate) => setForm({ ...form, operationDate })}
          />
          <Input
            required
            label="Касса / банковский счёт"
            value={form.account}
            onChange={(account) => setForm({ ...form, account })}
          />
          <Select
            label="Способ оплаты"
            value={form.method}
            onChange={(method) => setForm({ ...form, method })}
            options={paymentMethods}
          />
          <Input
            required
            label="Назначение платежа"
            value={form.purpose}
            onChange={(purpose) => setForm({ ...form, purpose })}
          />
          <Input
            label="Комментарий"
            value={form.comment}
            onChange={(comment) => setForm({ ...form, comment })}
          />
        </div>
        {number(form.amount) > remaining && (
          <p role="alert" className="text-sm text-red-300">
            Сумма выше остатка. Переплата проводится только отдельным
            подтверждённым действием.
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className={secondary} onClick={close}>
            Отмена
          </button>
          <button
            type="button"
            className={secondary}
            onClick={() =>
              setForm({
                ...form,
                payoutType: "full",
                amount: String(remaining),
              })
            }
          >
            Оплатить весь остаток
          </button>
          <button
            disabled={
              busy ||
              number(form.amount) <= 0 ||
              number(form.amount) > remaining
            }
            className={primary}
          >
            <HandCoins size={16} />
            Выплатить указанную сумму
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AdjustmentDialog({
  order,
  busy,
  close,
  submit,
}: {
  order: PartnerOrder;
  busy: boolean;
  close: () => void;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    kind: "increase",
    amount: "",
    operationDate: new Date().toISOString().slice(0, 10),
    comment: "",
  });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submit({
      action: "operation",
      relationId: order.relationId,
      type: "ADJUSTMENT",
      amount: form.amount,
      adjustmentEffect:
        form.kind === "increase" ? form.amount : `-${form.amount}`,
      operationDate: form.operationDate,
      comment: form.comment,
    });
  };
  return (
    <Dialog title="Дополнительная работа / корректировка" close={close}>
      <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
        <Select
          label="Влияние"
          value={form.kind}
          onChange={(kind) => setForm({ ...form, kind })}
          options={[
            ["increase", "Увеличить начисление"],
            ["decrease", "Уменьшить начисление"],
          ]}
        />
        <Input
          required
          label="Сумма"
          type="number"
          value={form.amount}
          onChange={(amount) => setForm({ ...form, amount })}
        />
        <Input
          required
          label="Дата"
          type="date"
          value={form.operationDate}
          onChange={(operationDate) => setForm({ ...form, operationDate })}
        />
        <Input
          required
          label="Основание"
          value={form.comment}
          onChange={(comment) => setForm({ ...form, comment })}
        />
        <DialogButtons
          busy={busy}
          close={close}
          label="Провести корректировку"
        />
      </form>
    </Dialog>
  );
}

function HistoricalLinkDialog({
  payment,
  orders,
  partners,
  busy,
  close,
  submit,
}: {
  payment: Payload["unallocatedOperations"][number];
  orders: PartnerOrder[];
  partners: Partner[];
  busy: boolean;
  close: () => void;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [form, setForm] = useState({
    orderId: payment.orderId ? String(payment.orderId) : "",
    partnerId: payment.partnerId ? String(payment.partnerId) : "",
    comment: "",
  });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submit({
      action: "link-historical-payment",
      paymentId: payment.id,
      orderId: Number(form.orderId),
      partnerId: Number(form.partnerId),
      comment: form.comment,
    });
  };
  return (
    <Dialog title="Привязать историческую выплату" close={close}>
      <form onSubmit={save} className="grid gap-3">
        <div className="grid grid-cols-2 gap-2">
          <Mini label="Дата" value={day(payment.operationDate)} />
          <Mini label="Сумма" value={money(payment.amount)} />
        </div>
        <Select
          required
          label="Заказ"
          value={form.orderId}
          onChange={(orderId) => setForm({ ...form, orderId })}
          options={orders.map((order) => [
            String(order.order.id),
            `${order.order.number} · ${order.order.client.name}`,
          ])}
        />
        <Select
          required
          label="Партнёр"
          value={form.partnerId}
          onChange={(partnerId) => setForm({ ...form, partnerId })}
          options={partners.map((partner) => [
            String(partner.id),
            partner.name,
          ])}
        />
        <Input
          required
          label="Причина ручной разноски"
          value={form.comment}
          onChange={(comment) => setForm({ ...form, comment })}
        />
        <p className="rounded-xl border border-amber-400/20 bg-amber-950/30 p-3 text-sm text-amber-100">
          Новая Finance operation не создаётся. Повторное связывание
          блокируется.
        </p>
        <DialogButtons busy={busy} close={close} label="Привязать" />
      </form>
    </Dialog>
  );
}

function OrderHistoryDialog({
  order,
  close,
}: {
  order: PartnerOrder;
  close: () => void;
}) {
  return (
    <Dialog title={`История · ${order.order.number}`} close={close}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <Mini
            label="Согласовано"
            value={money(order.economy.partner.agreed)}
          />
          <Mini
            label="Начислено"
            value={money(order.economy.partner.accrued)}
          />
          <Mini label="Выплачено" value={money(order.economy.partner.paid)} />
          <Mini
            label="Осталось"
            value={money(order.economy.partner.remaining)}
          />
        </div>
        {order.operations.map((operation) => (
          <div key={operation.id} className="rounded-xl bg-slate-950 p-3">
            <p className="font-semibold">
              {operationLabel(operation.type)} · {money(operation.amount)}
            </p>
            <p className="text-sm text-slate-400">
              {day(operation.operationDate)} ·{" "}
              {operation.createdBy?.name || "Система"}
              {operation.comment ? ` · ${operation.comment}` : ""}
            </p>
          </div>
        ))}
        {!order.operations.length && <Empty />}
      </div>
    </Dialog>
  );
}

function NewOrderDialog({
  data,
  busy,
  close,
  submit,
}: {
  data: Payload;
  busy: boolean;
  close: () => void;
  submit: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [clientSearch, setClientSearch] = useState("");
  const [clients, setClients] = useState<SearchClient[]>([]);
  const [form, setForm] = useState({
    partnerId: "",
    clientId: "",
    newClient: false,
    clientName: "",
    clientPhone: "",
    city: "",
    address: "",
    staircase: "Лестница",
    material: "",
    amount: "",
    partnerCost: "",
    orderDate: new Date().toISOString().slice(0, 10),
    promisedAt: "",
    managerUserId: "",
    comment: "",
    initialConfirmed: false,
    initialAmount: "",
    initialReceivedBy: "",
    initialAccount: "",
    initialMethod: "Банковский перевод",
  });
  const search = async () => {
    const response = await fetch(
      `/api/partner-management?view=search-clients&q=${encodeURIComponent(clientSearch)}`,
    );
    if (response.ok) setClients((await response.json()) as SearchClient[]);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    await submit({
      action: "create-order",
      ...form,
      partnerId: Number(form.partnerId),
      clientId: form.newClient ? undefined : Number(form.clientId),
      managerUserId: form.managerUserId
        ? Number(form.managerUserId)
        : undefined,
      client: form.newClient
        ? {
            name: form.clientName,
            phone: form.clientPhone,
            city: form.city,
            address: form.address,
          }
        : undefined,
      rewardRule: form.partnerCost ? "MANUAL" : undefined,
      manualAmount: form.partnerCost || undefined,
      initialPayment: {
        confirmed: form.initialConfirmed,
        amount: form.initialAmount || "0",
        date: form.orderDate,
        receivedBy: form.initialReceivedBy,
        account: form.initialAccount,
        method: form.initialMethod,
      },
    });
  };
  return (
    <Dialog title="Новый обычный заказ ORDA" close={close} wide>
      <form
        onSubmit={save}
        className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
      >
        <Select
          required
          label="Партнёр"
          value={form.partnerId}
          onChange={(partnerId) => setForm({ ...form, partnerId })}
          options={data.partners
            .filter((partner) => partner.businessStatus === "ACTIVE")
            .map((partner) => [String(partner.id), partner.name])}
        />
        <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-slate-700 px-3 text-sm">
          <input
            type="checkbox"
            checked={form.newClient}
            onChange={(event) =>
              setForm({ ...form, newClient: event.target.checked })
            }
          />
          Создать нового клиента
        </label>
        {!form.newClient && (
          <>
            <label className="text-sm text-slate-400">
              <span>Найти клиента</span>
              <div className="mt-1 flex gap-2">
                <input
                  className={field}
                  value={clientSearch}
                  onChange={(event) => setClientSearch(event.target.value)}
                />
                <button
                  type="button"
                  className={secondary}
                  onClick={() => void search()}
                >
                  <Search size={16} />
                </button>
              </div>
            </label>
            <Select
              required
              label="Клиент"
              value={form.clientId}
              onChange={(clientId) => setForm({ ...form, clientId })}
              options={clients.map((client) => [
                String(client.id),
                `${client.name} · ${client.phone}`,
              ])}
            />
          </>
        )}
        {form.newClient && (
          <>
            <Input
              required
              label="ФИО / компания"
              value={form.clientName}
              onChange={(clientName) => setForm({ ...form, clientName })}
            />
            <Input
              required
              label="Телефон"
              value={form.clientPhone}
              onChange={(clientPhone) => setForm({ ...form, clientPhone })}
            />
            <Input
              required
              label="Город"
              value={form.city}
              onChange={(city) => setForm({ ...form, city })}
            />
          </>
        )}
        <Input
          required
          label="Адрес объекта"
          value={form.address}
          onChange={(address) => setForm({ ...form, address })}
        />
        <Input
          required
          label="Изделие"
          value={form.staircase}
          onChange={(staircase) => setForm({ ...form, staircase })}
        />
        <Input
          required
          label="Материал"
          value={form.material}
          onChange={(material) => setForm({ ...form, material })}
        />
        <Input
          required
          label="Сумма продажи"
          type="number"
          value={form.amount}
          onChange={(amount) => setForm({ ...form, amount })}
        />
        <Input
          label="Стоимость партнёра (можно позже)"
          type="number"
          value={form.partnerCost}
          onChange={(partnerCost) => setForm({ ...form, partnerCost })}
        />
        <Input
          required
          label="Дата заказа"
          type="date"
          value={form.orderDate}
          onChange={(orderDate) => setForm({ ...form, orderDate })}
        />
        <Input
          label="Срок"
          type="date"
          value={form.promisedAt}
          onChange={(promisedAt) => setForm({ ...form, promisedAt })}
        />
        <Select
          label="Менеджер"
          value={form.managerUserId}
          onChange={(managerUserId) => setForm({ ...form, managerUserId })}
          options={[
            ["", "Не назначен"],
            ...data.managers.map(
              (manager) =>
                [String(manager.id), manager.name] as [string, string],
            ),
          ]}
        />
        <Input
          label="Комментарий"
          value={form.comment}
          onChange={(comment) => setForm({ ...form, comment })}
        />
        <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-slate-700 px-3 text-sm">
          <input
            type="checkbox"
            checked={form.initialConfirmed}
            onChange={(event) =>
              setForm({ ...form, initialConfirmed: event.target.checked })
            }
          />
          Первоначальная оплата фактически получена
        </label>
        {form.initialConfirmed && (
          <>
            <Input
              required
              label="Сумма оплаты"
              type="number"
              value={form.initialAmount}
              onChange={(initialAmount) => setForm({ ...form, initialAmount })}
            />
            <Input
              required
              label="Кто получил"
              value={form.initialReceivedBy}
              onChange={(initialReceivedBy) =>
                setForm({ ...form, initialReceivedBy })
              }
            />
            <Input
              required
              label="Касса / счёт"
              value={form.initialAccount}
              onChange={(initialAccount) =>
                setForm({ ...form, initialAccount })
              }
            />
          </>
        )}
        <div className="md:col-span-2 xl:col-span-3">
          <DialogButtons busy={busy} close={close} label="Создать заказ" />
        </div>
      </form>
    </Dialog>
  );
}

function Dialog({
  title,
  close,
  wide = false,
  children,
}: {
  title: string;
  close: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`max-h-[94vh] w-full overflow-y-auto rounded-t-3xl border border-white/10 bg-[#0b1220] p-4 shadow-2xl sm:rounded-3xl sm:p-6 ${wide ? "max-w-6xl" : "max-w-3xl"}`}
      >
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-white">{title}</h2>
          <button
            type="button"
            className={secondary}
            onClick={close}
            aria-label="Закрыть"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function DialogButtons({
  busy,
  close,
  label,
}: {
  busy: boolean;
  close: () => void;
  label: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
      <button type="button" className={secondary} onClick={close}>
        Отмена
      </button>
      <button disabled={busy} className={primary}>
        {busy ? "Сохранение…" : label}
      </button>
    </div>
  );
}
function Input({
  label,
  value,
  onChange,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-slate-400">
      <span>{label}</span>
      <input
        className={`${field} mt-1`}
        type={type}
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "0.01" : undefined}
      />
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  options,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<readonly [string, string]>;
  required?: boolean;
}) {
  return (
    <label className="text-sm text-slate-400">
      <span>{label}</span>
      <select
        required={required}
        className={`${field} mt-1`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {!options.some(([key]) => key === "") && (
          <option value="">Выберите</option>
        )}
        {options.map(([key, name]) => (
          <option key={`${key}-${name}`} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}
function FormTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-lg font-bold text-white md:col-span-2 xl:col-span-3">
      {children}
    </h2>
  );
}
function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-slate-950 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-bold text-slate-100">
        {value}
      </p>
    </div>
  );
}
function Empty() {
  return (
    <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
      Данных пока нет
    </p>
  );
}
function Quick({ label, action }: { label: string; action: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full border border-slate-700 bg-slate-900 px-3 py-2 hover:border-amber-300/50"
      onClick={action}
    >
      {label}
    </button>
  );
}

function Status({ value }: { value: string }) {
  const tone =
    value === "PAID" ||
    value === "CLOSED" ||
    value === "COMPLETED" ||
    value === "POSTED"
      ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-200"
      : value === "OVERDUE" ||
          value === "OVERPAID" ||
          value === "DISPUTED" ||
          value === "CANCELLED"
        ? "border-red-500/30 bg-red-950/40 text-red-200"
        : value === "PARTIAL" ||
            value === "PARTIALLY_PAID" ||
            value === "PAYABLE" ||
            value === "COST_MISSING" ||
            value === "NOT_ASSIGNED"
          ? "border-amber-400/30 bg-amber-950/40 text-amber-100"
          : "border-slate-700 bg-slate-900 text-slate-300";
  return (
    <span
      className={`inline-flex max-w-full rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}
    >
      {statusLabel(value)}
    </span>
  );
}

const periodOptions: Array<[string, string]> = [
  ["current_month", "Текущий месяц"],
  ["previous_month", "Предыдущий месяц"],
  ["quarter", "Квартал"],
  ["year", "Год"],
  ["custom", "Произвольный период"],
  ["all", "Всё время"],
];
const basisOptions: Array<[string, string]> = [
  ["order", "По дате заказа"],
  ["completion", "По дате завершения"],
  ["finance", "По дате финансовой операции"],
];
const scopeOptions: Array<[string, string]> = [
  ["active", "Все активные"],
  ["completed", "Завершённые"],
  ["all", "Все заказы"],
  ["with_partner", "С партнёром"],
  ["without_partner", "Без партнёра"],
  ["without_cost", "Без стоимости партнёра"],
];
const clientOptions: Array<[string, string]> = [
  ["", "Все статусы"],
  ["UNPAID", "Клиент не оплатил"],
  ["PARTIAL", "Оплатил частично"],
  ["PAID", "Оплатил полностью"],
  ["OVERPAID", "Переплата"],
  ["OVERDUE", "Просрочена оплата"],
];
const partnerStatusOptions: Array<[string, string]> = [
  ["", "Все статусы"],
  ["NOT_ASSIGNED", "Партнёр не назначен"],
  ["COST_MISSING", "Стоимость не указана"],
  ["NOT_ACCRUED", "Не начислено"],
  ["PAYABLE", "К выплате"],
  ["PARTIALLY_PAID", "Частично выплачено"],
  ["PAID", "Выплачено полностью"],
  ["OVERDUE", "Просрочена выплата"],
  ["OVERPAID", "Переплата"],
  ["DISPUTED", "Спорный"],
];
const profitOptions: Array<[string, string]> = [
  ["", "Все"],
  ["profitable", "Прибыльные"],
  ["loss", "Убыточные"],
  ["highest_profit", "Самая высокая прибыль"],
  ["highest_margin", "Самая высокая маржа"],
  ["lowest_margin", "Самая низкая маржа"],
];
const sortOptions: Array<[string, string]> = [
  ["newest", "Сначала новые"],
  ["oldest", "Сначала старые"],
  ["sale_desc", "Продажа: по убыванию"],
  ["client_debt_desc", "Долг клиента: по убыванию"],
  ["partner_debt_desc", "Долг партнёру: по убыванию"],
  ["profit_desc", "Прибыль: по убыванию"],
  ["margin_desc", "Маржа: по убыванию"],
  ["margin_asc", "Маржа: по возрастанию"],
];
const partnerKinds: Array<[string, string]> = [
  ["REFERRER", "Рекомендатель"],
  ["SALES_AGENT", "Агент по продажам"],
  ["DEALER", "Дилер"],
  ["DESIGNER", "Дизайнер"],
  ["ARCHITECT", "Архитектор"],
  ["CONSTRUCTION_COMPANY", "Строительная компания"],
  ["CONTRACTOR", "Подрядчик / цех"],
  ["OTHER", "Другой"],
];
const rewardRules: Array<[string, string]> = [
  ["FIXED", "Фиксированная сумма"],
  ["ORDER_PERCENT", "% от суммы заказа"],
  ["PAID_PERCENT", "% от полученной оплаты"],
  ["PROFIT_PERCENT", "% от валовой прибыли"],
  ["MANUAL", "Согласованная сумма"],
];
const paymentMethods: Array<[string, string]> = [
  ["Наличные", "Наличные"],
  ["Kaspi", "Kaspi"],
  ["Банковский перевод", "Банковский перевод"],
];
const kindLabel = (value: string) =>
  partnerKinds.find(([key]) => key === value)?.[1] ?? value;
const rewardLabel = (value: string) =>
  rewardRules.find(([key]) => key === value)?.[1] ?? value;
const operationLabel = (value: string) =>
  (
    ({
      CLIENT_TO_COMPANY: "Клиент → компания",
      CLIENT_TO_PARTNER: "Клиент → партнёр",
      PARTNER_TO_COMPANY: "Партнёр → компания",
      COMPANY_TO_PARTNER: "Компания → партнёр",
      CLIENT_REFUND: "Возврат клиенту",
      PARTNER_REFUND: "Возврат от партнёра",
      ADJUSTMENT: "Корректировка",
      REVERSAL: "Сторно",
    }) as Record<string, string>
  )[value] ?? value;
const statusLabel = (value: string) =>
  (
    ({
      ACTIVE: "Активный",
      SUSPENDED: "Приостановлен",
      ARCHIVED: "Архивный",
      CREATED: "Создан",
      PREPARATION: "Подготовка",
      READY_FOR_PRODUCTION: "Готов к производству",
      IN_PRODUCTION: "В производстве",
      READY_FOR_INSTALLATION: "Готов к монтажу",
      INSTALLATION: "Монтаж",
      ACCEPTANCE: "Приёмка",
      COMPLETED: "Завершён",
      CANCELLED: "Отменён",
      UNPAID: "Не оплачено",
      PARTIAL: "Частично оплачено",
      PAID: "Оплачено",
      OVERPAID: "Переплата",
      OVERDUE: "Просрочено",
      NOT_ASSIGNED: "Не передан в цех",
      COST_MISSING: "Стоимость не указана",
      NOT_ACCRUED: "Не начислено",
      PAYABLE: "К выплате",
      PARTIALLY_PAID: "Частично выплачено",
      DISPUTED: "Спорный",
      POSTED: "Проведена",
      REVERSED: "Сторнирована",
      CLOSED: "Закрыт",
    }) as Record<string, string>
  )[value] ?? value;
const basisDescription = (value: string) =>
  value === "completion"
    ? "Фактическая прибыль — по дате завершения."
    : value === "finance"
      ? "Оплаты и выплаты — по дате денежной операции."
      : "Продажи и плановая прибыль — по дате заказа.";
const apiError = (value?: string) =>
  (
    ({
      PARTNER_NOT_ASSIGNED: "Сначала назначьте партнёра.",
      PARTNER_COST_NOT_SET: "Сначала укажите согласованную стоимость партнёра.",
      PAYOUT_EXCEEDS_PARTNER_BALANCE: "Сумма выплаты выше остатка.",
      PARTNER_REASSIGNMENT_WITH_PAYMENTS:
        "Нельзя изменить партнёра после проведённой выплаты без отдельной процедуры.",
      DISPUTE_REASON_REQUIRED: "Укажите причину спорного расчёта.",
      HISTORICAL_LINK_REASON_REQUIRED: "Укажите причину ручной разноски.",
      PAYMENT_ALREADY_LINKED: "Эта операция уже разнесена.",
      INVALID_AMOUNT: "Укажите корректную положительную сумму.",
    }) as Record<string, string>
  )[value ?? ""] ??
  value ??
  "Операция не выполнена";
