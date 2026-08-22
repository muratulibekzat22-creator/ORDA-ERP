"use client";

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import OrderTable, { type OrderListItem } from "@/components/orders/OrderTable";
import { ORDER_STAGE_KEYS, ORDER_STAGE_LABELS, isOrderOverdue, orderDeadline, type OrderStageKey } from "@/lib/orders/presentation";

type SettlementFilter =
  | "partner-payable"
  | "without-partner"
  | "without-partner-price"
  | "overdue-client"
  | "overdue-partner"
  | "client-payable"
  | "without-contract"
  | "overdue-order";
type Filter = "all" | "active" | "today" | OrderStageKey | "overdue" | SettlementFilter;
type FilterMetric = { count: number; amount: string };
const settlementFilters: SettlementFilter[] = [
  "partner-payable",
  "without-partner",
  "without-partner-price",
  "overdue-client",
  "overdue-partner",
  "client-payable",
  "without-contract",
];
const money = (value?: string) =>
  value == null ? "—" : `${Number(value).toLocaleString("ru-RU")} ₸`;

function PartnerPayableTable({ orders }: { orders: OrderListItem[] }) {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <article
            key={order.id}
            className="rounded-2xl border border-amber-900/60 bg-[#101827] p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="text-white">Заказ {order.number}</strong>
                <p className="mt-1 break-words text-sm text-slate-300">
                  {order.client.name.trim() || "Клиент не указан"}
                </p>
              </div>
              <span className="rounded-full bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
                К выплате
              </span>
            </div>
            <p className="mt-3 text-sm text-slate-400">
              Цех / партнёр
              <br />
              <span className="break-words text-slate-100">
                {order.partner?.name ?? "Не назначен"}
              </span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <p className="text-slate-400">
                Стоимость цеха
                <br />
                <span className="text-white">{money(order.partnerPrice)}</span>
              </p>
              <p className="text-slate-400">
                Выплачено
                <br />
                <span className="text-emerald-300">
                  {money(order.partnerPaid)}
                </span>
              </p>
              <p className="col-span-2 text-slate-400">
                Осталось выплатить
                <br />
                <strong className="text-amber-300">
                  {money(order.partnerBalance)}
                </strong>
              </p>
            </div>
            <Link
              href={`/orders/${order.id}?action=assign-workshop#settlements`}
              className="mt-4 block min-h-11 rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold text-white"
            >
              Открыть расчёты
            </Link>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-[#101827] md:block">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-slate-950/60 text-left text-slate-400">
            <tr>
              {[
                "Заказ",
                "Клиент",
                "Партнёр / цех",
                "Стоимость цеха",
                "Выплачено",
                "Остаток",
                "",
              ].map((title) => (
                <th key={title} className="px-4 py-3 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                className="border-t border-slate-800 text-slate-200 hover:bg-slate-900/50"
              >
                <td className="px-4 py-4 font-semibold text-white">
                  {order.number}
                </td>
                <td className="px-4 py-4">{order.client.name.trim() || "Клиент не указан"}</td>
                <td className="px-4 py-4">{order.partner?.name ?? "—"}</td>
                <td className="px-4 py-4">{money(order.partnerPrice)}</td>
                <td className="px-4 py-4 text-emerald-300">
                  {money(order.partnerPaid)}
                </td>
                <td className="px-4 py-4 font-semibold text-amber-300">
                  {money(order.partnerBalance)}
                </td>
                <td className="px-4 py-4">
                  <Link
                    href={`/orders/${order.id}?action=assign-workshop#settlements`}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-white"
                  >
                    Открыть
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WithoutPartnerTable({ orders }: { orders: OrderListItem[] }) {
  return (
    <>
      <div className="space-y-3 md:hidden">
        {orders.map((order) => (
          <article
            key={order.id}
            className="rounded-2xl border border-amber-900/60 bg-[#101827] p-4"
          >
            <strong className="text-white">Заказ {order.number}</strong>
            <p className="mt-1 text-sm text-slate-300">
              {order.client.name.trim() || "Клиент не указан"} · {order.material}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <p className="text-slate-400">
                Сумма заказа
                <br />
                <span className="text-white">{money(order.amount)}</span>
              </p>
              <p className="text-slate-400">
                Получено
                <br />
                <span className="text-emerald-300">
                  {money(order.prepayment)}
                </span>
              </p>
              <p className="text-slate-400">
                Остаток клиента
                <br />
                <span className="text-amber-300">{money(order.balance)}</span>
              </p>
              <p className="text-slate-400">
                Менеджер
                <br />
                <span className="text-white">{order.manager}</span>
              </p>
            </div>
            <Link
              href={`/orders/${order.id}?action=assign-workshop#settlements`}
              className="mt-4 block min-h-11 rounded-xl bg-blue-600 px-4 py-3 text-center font-semibold text-white"
            >
              Назначить цех
            </Link>
          </article>
        ))}
      </div>
      <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-[#101827] md:block">
        <table className="w-full min-w-[980px] text-sm">
          <thead className="bg-slate-950/60 text-left text-slate-400">
            <tr>
              {[
                "Заказ",
                "Клиент",
                "Сумма заказа",
                "Получено",
                "Остаток клиента",
                "Материал",
                "Менеджер",
                "",
              ].map((title) => (
                <th key={title} className="px-4 py-3 font-medium">
                  {title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                className="border-t border-slate-800 text-slate-200"
              >
                <td className="px-4 py-4 font-semibold text-white">
                  {order.number}
                </td>
                <td className="px-4 py-4">{order.client.name.trim() || "Клиент не указан"}</td>
                <td className="px-4 py-4">{money(order.amount)}</td>
                <td className="px-4 py-4 text-emerald-300">
                  {money(order.prepayment)}
                </td>
                <td className="px-4 py-4 text-amber-300">
                  {money(order.balance)}
                </td>
                <td className="px-4 py-4">{order.material}</td>
                <td className="px-4 py-4">{order.manager}</td>
                <td className="px-4 py-4">
                  <Link
                    href={`/orders/${order.id}?action=assign-workshop#settlements`}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-white"
                  >
                    Назначить цех
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function FilterGroup({ title, items, active, counts, metrics, onSelect, showAmount = false }: {
  title: string;
  items: Array<[Filter, string]>;
  active: Filter;
  counts: Record<Filter, number>;
  metrics: Partial<Record<Filter, FilterMetric>>;
  onSelect: (filter: Filter) => void;
  showAmount?: boolean;
}) {
  return <div>
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</p>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {items.map(([key, label]) => <button key={key} type="button" onClick={() => onSelect(key)} className={`min-h-11 min-w-0 rounded-xl border px-3 py-2 text-left text-sm ${active === key ? "border-blue-500 bg-blue-500/10 text-white" : "border-slate-800 bg-slate-950 text-slate-300 hover:border-slate-700"}`}>
        <span className="block break-words font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{counts[key]} заказов{showAmount ? ` · ${money(metrics[key]?.amount ?? "0")}` : ""}</span>
      </button>)}
    </div>
  </div>;
}

export default function OrdersPage({
  initialSettlementFilter,
}: {
  initialSettlementFilter?: string;
}) {
  const { data: session } = useSession();
  const initial = initialSettlementFilter === "overdue"
    ? "overdue-order"
    : settlementFilters.includes(initialSettlementFilter as SettlementFilter)
      ? (initialSettlementFilter as Filter)
      : "all";
  const [orders, setOrders] = useState<OrderListItem[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [serverQuery, setServerQuery] = useState(""),
    [filter, setFilter] = useState<Filter>(initial),
    [visibleCount, setVisibleCount] = useState(30),
    [view, setView] = useState<"active" | "deleted">("active"),
    [page, setPage] = useState(1),
    [totalPages, setTotalPages] = useState(1),
    [totalOrders, setTotalOrders] = useState(0),
    [filterMetrics, setFilterMetrics] = useState<Partial<Record<Filter, FilterMetric>>>({}),
    [cities, setCities] = useState<string[]>([]),
    [city, setCity] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const internalSettlement = ["DIRECTOR", "ACCOUNTANT"].includes(
    session?.user.role ?? "",
  );
  const requestFilter: Filter =
    session?.user &&
    settlementFilters.includes(filter as SettlementFilter) &&
    !internalSettlement
      ? "all"
      : filter;
  useEffect(() => {
    const timer = window.setTimeout(() => setServerQuery(deferredQuery), 300);
    return () => window.clearTimeout(timer);
  }, [deferredQuery]);
  const load = useCallback(async (targetPage = 1, append = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        page: String(targetPage),
        limit: "50",
      });
      if (view === "deleted") params.set("deletedOnly", "true");
      if (serverQuery) params.set("query", serverQuery);
      if (city) params.set("city", city);
      if (requestFilter !== "all") params.set("filter", requestFilter);
      const response = await fetch(`/api/orders?${params}`),
        payload = (await response.json()) as
          | OrderListItem[]
          | {
              data?: OrderListItem[];
              pagination?: {
                page: number;
                total: number;
                totalPages: number;
              };
              error?: string;
              filterMetrics?: Partial<Record<Filter, FilterMetric>>;
              filters?: { cities?: string[] };
            };
      if (!response.ok || Array.isArray(payload) || !Array.isArray(payload.data))
        throw new Error(
          !Array.isArray(payload)
            ? payload.error
            : "Не удалось загрузить заказы",
        );
      setOrders((current) =>
        append ? [...current, ...payload.data!] : payload.data!,
      );
      setPage(payload.pagination?.page ?? targetPage);
      setTotalPages(payload.pagination?.totalPages ?? 1);
      setTotalOrders(payload.pagination?.total ?? payload.data.length);
      setFilterMetrics(payload.filterMetrics ?? {});
      setCities(payload.filters?.cities ?? []);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить заказы",
      );
    } finally {
      setLoading(false);
    }
  }, [city, requestFilter, serverQuery, view]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const director = session?.user.role === "DIRECTOR";
  const canManage = ["DIRECTOR", "MANAGER"].includes(session?.user.role ?? "");
  const activeFilter = requestFilter;
  const counts = useMemo(() => Object.fromEntries(
    (["all", "active", "today", "overdue", "overdue-order", ...ORDER_STAGE_KEYS, ...settlementFilters] as Filter[])
      .map((key) => [key, filterMetrics[key]?.count ?? (key === activeFilter ? totalOrders : 0)]),
  ) as Record<Filter, number>, [activeFilter, filterMetrics, totalOrders]);
  const filtered = useMemo(
    () =>
      orders
        .filter((order) => {
          const haystack =
            `${order.number} ${order.client.name} ${order.client.phone} ${order.client.city}`.toLowerCase();
          if (deferredQuery && !haystack.includes(deferredQuery)) return false;
          return true;
        })
        .sort((a, b) => {
          if (
            activeFilter === "partner-payable" ||
            activeFilter === "overdue-partner"
          )
            return Number(b.partnerBalance) - Number(a.partnerBalance);
          const aOverdue = isOrderOverdue(orderDeadline(a), a.lifecycle),
            bOverdue = isOrderOverdue(orderDeadline(b), b.lifecycle);
          if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
          const ad = orderDeadline(a),
            bd = orderDeadline(b);
          return (
            (ad ? new Date(ad).getTime() : Infinity) -
            (bd ? new Date(bd).getTime() : Infinity)
          );
        }),
    [orders, deferredQuery, activeFilter],
  );
  const quickFilters: Array<[Filter, string]> = [["all", "Все"], ["active", "Активные"], ["today", "Сегодня"], ["overdue-order", "Просроченные"], ["completed", "Завершённые"]];
  const stageFilters = ORDER_STAGE_KEYS.map((key) => [key, ORDER_STAGE_LABELS[key]] as [Filter, string]);
  const financeFilters: Array<[Filter, string]> = [
    ["client-payable", "К получению от клиентов"], ["partner-payable", "К выплате партнёрам"],
    ["without-partner", "Без партнёра"], ["without-partner-price", "Без стоимости партнёра"],
    ["without-contract", "Без договора"], ["overdue-client", "Просрочена оплата клиента"],
    ["overdue-partner", "Просрочен срок партнёра"], ["overdue-order", "Просрочен срок заказа"],
  ];
  const summaryCards: Array<[Filter, string]> = [
    ["all", "Все"],
    ["measurement", "Контрольный замер"],
    ["preparation", "В работе"],
    ["ready", "Готовы к установке"],
    ["installation", "На установке"],
    ["overdue-order", "Просрочены"],
  ];
  if (internalSettlement)
    summaryCards.push(
      ["without-partner", "Без партнёра"],
      ["partner-payable", "К выплате цеху"],
    );
  return (
    <section className="space-y-5 p-4 md:p-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Заказы</h1>
          <p className="mt-1 text-slate-400">
            Полученные заказы: от контрольного замера до установки
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          {view === "active" &&
            ["DIRECTOR", "MANAGER"].includes(session?.user.role ?? "") && (
              <Link
                href="/orders/new"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white"
              >
                <Plus size={18} /> Новый заказ
              </Link>
            )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="min-h-11 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-50"
          >
            Обновить
          </button>
        </div>
      </header>
      {director && (
        <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-800 bg-[#101827] p-2 sm:w-fit">
          <button
            type="button"
            onClick={() => {
              setView("active");
              setFilter("all");
              setVisibleCount(30);
            }}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${view === "active" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
          >
            Активные
          </button>
          <button
            type="button"
            onClick={() => {
              setView("deleted");
              setFilter("all");
              setVisibleCount(30);
            }}
            className={`min-h-11 rounded-xl px-4 text-sm font-semibold ${view === "deleted" ? "bg-amber-600 text-white" : "text-slate-300 hover:bg-slate-800"}`}
          >
            Удалённые / Архив
          </button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-8">
        {summaryCards.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`rounded-xl border p-3 text-left ${activeFilter === key ? "border-blue-500 bg-blue-500/10" : settlementFilters.includes(key as SettlementFilter) ? "border-amber-900/60 bg-amber-950/10" : "border-slate-800 bg-[#101827]"}`}
          >
            <span className="block text-xs text-slate-400">{label}</span>
            <strong
              className={
                (key === "overdue-order" ||
                  settlementFilters.includes(key as SettlementFilter)) &&
                counts[key]
                  ? "text-amber-300"
                  : "text-white"
              }
            >
              {counts[key]}
            </strong>
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-slate-800 bg-[#101827] p-3">
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_220px]">
          <input value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(30); }} placeholder="Номер заказа, клиент, телефон или город" className="min-h-11 min-w-0 rounded-xl bg-slate-950 px-4 text-white outline-none" />
          <select value={city} onChange={(event) => { setCity(event.target.value); setVisibleCount(30); }} className="min-h-11 min-w-0 rounded-xl bg-slate-950 px-3 text-white outline-none" aria-label="Фильтр по городу">
            <option value="">Все города</option>{cities.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <details className="mt-3 rounded-xl border border-slate-800 p-3" open>
          <summary className="min-h-8 cursor-pointer font-semibold text-blue-300">Фильтры</summary>
          <div className="mt-3 grid gap-5">
            <FilterGroup title="Быстрые фильтры" items={quickFilters} active={activeFilter} counts={counts} metrics={filterMetrics} onSelect={(value) => { setFilter(value); setVisibleCount(30); }}/>
            <FilterGroup title="Этап производства" items={stageFilters} active={activeFilter} counts={counts} metrics={filterMetrics} onSelect={(value) => { setFilter(value); setVisibleCount(30); }}/>
            {internalSettlement ? <FilterGroup title="Финансы и проблемы" items={financeFilters} active={activeFilter} counts={counts} metrics={filterMetrics} showAmount onSelect={(value) => { setFilter(value); setVisibleCount(30); }}/> : null}
          </div>
        </details>
      </div>
      {error ? (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      ) : loading ? (
        <p className="text-slate-400">Загрузка заказов…</p>
      ) : filtered.length ? (
        <>
          {activeFilter === "partner-payable" ? (
            <PartnerPayableTable orders={filtered.slice(0, visibleCount)} />
          ) : activeFilter === "without-partner" ? (
            <WithoutPartnerTable orders={filtered.slice(0, visibleCount)} />
          ) : (
            <OrderTable
              orders={filtered.slice(0, visibleCount)}
              canManage={canManage && view === "active"}
              canRestore={director && view === "deleted"}
              onChanged={(id) =>
                setOrders((current) =>
                  current.filter((order) => order.id !== id),
                )
              }
            />
          )}{" "}
          {(visibleCount < filtered.length || page < totalPages) && (
            <button
              onClick={() => {
                if (visibleCount < filtered.length)
                  setVisibleCount((value) => value + 30);
                else void load(page + 1, true);
              }}
              disabled={loading}
              className="mx-auto block min-h-11 rounded-xl bg-slate-800 px-6 text-white"
            >
              Показать ещё
            </button>
          )}
        </>
      ) : (
        <p className="rounded-2xl border border-slate-800 p-8 text-center text-slate-400">
          {activeFilter === "partner-payable"
            ? "Заказов с остатком к выплате цеху нет"
            : activeFilter === "without-partner"
              ? "Заказов без назначенного цеха нет"
              : "Заказы не найдены"}
        </p>
      )}
    </section>
  );
}
