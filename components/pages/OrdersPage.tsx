"use client";

import { Plus, Search } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useState,
} from "react";

import OrderTable, { type OrderListItem } from "@/components/orders/OrderTable";
import OrderKanban from "@/components/orders/OrderKanban";
import {
  USER_ORDER_STATUSES,
  USER_ORDER_STATUS_LABELS,
  type UserOrderStatus,
} from "@/lib/orders/presentation";

type Tab = "applications" | "board" | "completed";
type Application = {
  id: number;
  name: string;
  phone: string;
  city: string;
  stage: string;
  manager: string;
  updatedAt: string;
};
type Pagination = { page: number; total: number; totalPages?: number; pages?: number };

const tabs: Array<[Tab, string]> = [
  ["applications", "Заявки"],
  ["board", "Канбан"],
  ["completed", "Завершённые"],
];

const normalizeTab = (value: string): Tab =>
  value === "active" ? "board" : tabs.some(([tab]) => tab === value) ? value as Tab : "board";

export default function OrdersPage({
  initialTab = "board",
  initialStatus = "all",
  initialAttention = "",
}: {
  initialTab?: string;
  initialStatus?: string;
  initialAttention?: string;
}) {
  const [tab, setTab] = useState<Tab>(normalizeTab(initialTab));
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [status, setStatus] = useState<"all" | UserOrderStatus>(
    USER_ORDER_STATUSES.includes(initialStatus as UserOrderStatus)
      ? (initialStatus as UserOrderStatus)
      : "all",
  );
  const [attention, setAttention] = useState(
    ["overdue", "missing-production-price"].includes(initialAttention)
      ? initialAttention
      : "",
  );
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [applications, setApplications] = useState<Application[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const updateUrl = useCallback((nextTab: Tab, nextStatus: string, nextAttention = "") => {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    if (nextStatus !== "all" && nextTab !== "applications") params.set("status", nextStatus);
    if (nextAttention && nextTab !== "applications") params.set("attention", nextAttention);
    window.history.replaceState(null, "", `/orders?${params.toString()}`);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: tab === "board" ? "100" : "30" });
      if (deferredQuery.trim())
        params.set(tab === "applications" ? "search" : "query", deferredQuery.trim());
      if (tab === "applications") params.set("compact", "true");
      else {
        params.set("tab", tab);
        if (status !== "all") params.set("status", status);
        if (attention) params.set("attention", attention);
      }
      const response = await fetch(
        `${tab === "applications" ? "/api/clients" : "/api/orders"}?${params}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        data?: OrderListItem[] | Application[];
        pagination?: Pagination;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить список");
      if (tab === "applications") {
        setApplications((body.data ?? []) as Application[]);
        setOrders([]);
      } else {
        setOrders((body.data ?? []) as OrderListItem[]);
        setApplications([]);
      }
      setPagination(body.pagination ?? { page: 1, total: 0, totalPages: 1 });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить список");
    } finally {
      setLoading(false);
    }
  }, [attention, deferredQuery, page, status, tab]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 120);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changeTab = (value: Tab) => {
    setTab(value);
    setPage(1);
    setStatus("all");
    setAttention("");
    updateUrl(value, "all");
  };
  const changeStatus = (value: "all" | UserOrderStatus) => {
    setStatus(value);
    setPage(1);
    setAttention("");
    updateUrl(tab, value);
  };
  const changeAttention = (value: string) => {
    setAttention(value);
    setPage(1);
    updateUrl(tab, status, value);
  };
  const pages = pagination.totalPages ?? pagination.pages ?? 1;

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 overflow-x-hidden p-4 pb-24 text-white sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Продажи</p>
          <h1 className="mt-1 text-3xl font-bold">Заказы</h1>
          <p className="mt-1 text-sm text-slate-400">Заявки и заказы в одном рабочем разделе.</p>
        </div>
        <Link href="/orders/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold hover:bg-blue-500">
          <Plus size={18} /> Новый заказ
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-[#101827] p-1">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" onClick={() => changeTab(value)} className={`min-h-11 rounded-xl px-2 text-sm font-semibold transition sm:px-4 ${tab === value ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>

      <section className="grid gap-3 rounded-2xl border border-slate-800 bg-[#101827] p-3 sm:grid-cols-[minmax(0,1fr)_220px_240px]">
        <label className="relative min-w-0">
          <span className="sr-only">Поиск</span>
          <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={18} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Номер, клиент или телефон" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-white outline-none focus:border-blue-500" />
        </label>
        <label className={tab === "applications" ? "hidden" : "block"}>
          <span className="sr-only">Укрупнённый статус</span>
          <select value={status} onChange={(event) => changeStatus(event.target.value as "all" | UserOrderStatus)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">
            <option value="all">Все статусы</option>
            {USER_ORDER_STATUSES.filter((value) =>
              tab === "completed"
                ? value === "COMPLETED" || value === "CANCELLED"
                : value !== "COMPLETED" && value !== "CANCELLED",
            ).map((value) => <option key={value} value={value}>{USER_ORDER_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
        <label className={tab === "applications" ? "hidden" : "block"}>
          <span className="sr-only">Контроль данных</span>
          <select value={attention} onChange={(event) => changeAttention(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">
            <option value="">Все данные</option>
            <option value="missing-production-price">Без цены производства</option>
            <option value="overdue">Только просроченные</option>
          </select>
        </label>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</p>}
      {loading ? <div className="h-56 animate-pulse rounded-2xl bg-slate-900" /> : tab === "applications" ? <ApplicationsList applications={applications} /> : orders.length ? tab === "board" ? <OrderKanban orders={orders} /> : <OrderTable orders={orders} /> : <Empty tab={tab} />}

      {!loading && pagination.total > 0 && (
        <footer className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-[#101827] p-3 text-sm text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span>Найдено: {pagination.total}</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-10 flex-1 rounded-lg border border-slate-700 px-4 disabled:opacity-40 sm:flex-none">Назад</button>
            <span className="grid min-h-10 min-w-20 place-items-center">{page} / {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} className="min-h-10 flex-1 rounded-lg border border-slate-700 px-4 disabled:opacity-40 sm:flex-none">Далее</button>
          </div>
        </footer>
      )}
    </main>
  );
}

function ApplicationsList({ applications }: { applications: Application[] }) {
  if (!applications.length) return <Empty tab="applications" />;
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{applications.map((application) => <Link key={application.id} href={`/clients/${application.id}`} className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4 hover:border-blue-500/50"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><strong className="block truncate">{application.name}</strong><p className="truncate text-sm text-slate-400">{application.phone} · {application.city}</p></div><span className="rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-200">Заявка</span></div><p className="mt-3 text-sm text-slate-400">Ответственный: <span className="text-slate-200">{application.manager || "—"}</span></p></Link>)}</div>;
}

function Empty({ tab }: { tab: Tab }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-slate-400">{tab === "applications" ? "Заявок пока нет" : tab === "completed" ? "Завершённых заказов пока нет" : "Заказов по выбранному фильтру нет"}</div>;
}
