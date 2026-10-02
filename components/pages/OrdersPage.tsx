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
  ORDER_BOARD_TARGET_LIFECYCLE,
  orderBoardColumn,
  type OrderBoardColumn,
} from "@/lib/orders/board";
import {
  USER_ORDER_STATUSES,
  USER_ORDER_STATUS_LABELS,
  type UserOrderStatus,
} from "@/lib/orders/presentation";

type Tab = "board" | "all" | "completed";
type Pagination = { page: number; total: number; totalPages?: number; pages?: number };

const tabs: Array<[Tab, string]> = [
  ["board", "Активные заказы"],
  ["all", "Все заказы"],
  ["completed", "Завершённые заказы"],
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
    ["overdue", "incomplete", "missing-production-price", "order-date"].includes(initialAttention)
      ? initialAttention
      : "",
  );
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [movingIds, setMovingIds] = useState<Set<number>>(new Set());

  const updateUrl = useCallback((nextTab: Tab, nextStatus: string, nextAttention = "") => {
    const params = new URLSearchParams();
    params.set("tab", nextTab);
    if (nextStatus !== "all") params.set("status", nextStatus);
    if (nextAttention) params.set("attention", nextAttention);
    window.history.replaceState(null, "", `/orders?${params.toString()}`);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: tab === "board" ? "100" : "30" });
      if (deferredQuery.trim()) params.set("query", deferredQuery.trim());
      params.set("tab", tab);
      if (status !== "all") params.set("status", status);
      if (attention) params.set("attention", attention);
      const response = await fetch(
        `/api/orders?${params}`,
        { cache: "no-store" },
      );
      const body = (await response.json()) as {
        data?: OrderListItem[];
        pagination?: Pagination;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить список");
      setOrders(body.data ?? []);
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

  async function moveOrder(id: number, column: OrderBoardColumn) {
    const current = orders.find((order) => order.id === id);
    if (!current || movingIds.has(id) || orderBoardColumn(current.lifecycle) === column) return;
    setError("");
    setMovingIds((ids) => new Set(ids).add(id));
    try {
      const transitionResponse = await fetch(`/api/orders/${id}/available-transitions`, { cache: "no-store" });
      const transitionPayload = await transitionResponse.json() as {
        version?: number;
        transitions?: Array<{ to: string; gate: { passed: boolean; checks: Array<{ passed: boolean; message: string }> } }>;
        error?: string;
      };
      if (!transitionResponse.ok) throw new Error(transitionPayload.error ?? "Не удалось проверить переход");
      const target = ORDER_BOARD_TARGET_LIFECYCLE[column];
      const transition = transitionPayload.transitions?.find((item) => item.to === target);
      if (!transition) throw new Error("Перемещайте заказ последовательно в доступный этап");
      if (!transition.gate.passed) {
        const missing = transition.gate.checks.filter((item) => !item.passed).map((item) => item.message).join(" · ");
        throw new Error(missing || "Сначала заполните обязательные данные этапа");
      }

      const snapshot = orders;
      setOrders((items) => items.map((order) => order.id === id ? { ...order, lifecycle: target } : order));
      const response = await fetch(`/api/orders/${id}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "transition", to: target, expectedVersion: transitionPayload.version }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) {
        setOrders(snapshot);
        throw new Error(body.error ?? "Не удалось переместить заказ");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось переместить заказ");
    } finally {
      setMovingIds((ids) => { const next = new Set(ids); next.delete(id); return next; });
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1600px] space-y-5 overflow-x-hidden p-4 pb-24 text-white sm:p-6 lg:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-widest text-blue-400">Продажи</p>
          <h1 className="mt-1 text-3xl font-bold">Заказы</h1>
          <p className="mt-1 text-sm text-slate-400">Активные заказы — в работе. В разделе «Завершённые заказы» показываются только полностью завершённые работы; отменённые записи остаются доступными во вкладке «Все заказы».</p>
        </div>
        <Link href="/orders/new" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold hover:bg-blue-500">
          <Plus size={18} /> Новый заказ
        </Link>
      </header>

      <div className="grid grid-cols-3 gap-1 rounded-2xl border border-slate-800 bg-[#101827] p-1">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={tab === value} onClick={() => changeTab(value)} className={`min-h-11 rounded-xl px-2 text-sm font-semibold transition sm:px-4 ${tab === value ? "bg-blue-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "completed" && <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">Закрытие работ не означает погашение долга. Остатки оплаты видны в таблице; договоры, платежи и история доступны внутри заказа. Здесь ничего не удаляется.</p>}

      <section className="grid gap-3 rounded-2xl border border-slate-800 bg-[#101827] p-3 sm:grid-cols-[minmax(0,1fr)_220px_240px]">
        <label className="relative min-w-0">
          <span className="sr-only">Поиск</span>
          <Search className="pointer-events-none absolute left-3 top-3 text-slate-500" size={18} />
          <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Номер, клиент или телефон" className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 pl-10 pr-3 text-white outline-none focus:border-blue-500" />
        </label>
        <label className="block">
          <span className="sr-only">Укрупнённый статус</span>
          <select value={status} onChange={(event) => changeStatus(event.target.value as "all" | UserOrderStatus)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">
            <option value="all">Все статусы</option>
            {USER_ORDER_STATUSES.filter((value) =>
              tab === "completed"
                ? value === "COMPLETED"
                : tab === "all" || (value !== "COMPLETED" && value !== "CANCELLED"),
            ).map((value) => <option key={value} value={value}>{USER_ORDER_STATUS_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Контроль данных</span>
          <select value={attention} onChange={(event) => changeAttention(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white">
            <option value="">Все данные</option>
            <option value="incomplete">Все заказы с замечаниями</option>
            <option value="order-date">Без подтверждённой даты заказа</option>
            <option value="missing-production-price">Без цены производства</option>
            <option value="overdue">Только просроченные</option>
          </select>
        </label>
      </section>

      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</p>}
      {loading ? <div className="h-56 animate-pulse rounded-2xl bg-slate-900" /> : orders.length ? tab === "board" ? <OrderKanban orders={orders} movingIds={movingIds} onMove={moveOrder} /> : <OrderTable orders={orders} /> : <Empty tab={tab} />}

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

function Empty({ tab }: { tab: Tab }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 p-12 text-center text-slate-400">{tab === "completed" ? "Завершённых заказов по выбранному фильтру нет" : "Заказов по выбранному фильтру нет"}</div>;
}
