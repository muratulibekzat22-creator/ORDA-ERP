"use client";

import { AlertCircle, CalendarDays, CircleDollarSign, GripVertical, UserRound, WalletCards } from "lucide-react";
import Link from "next/link";

import type { OrderListItem } from "@/components/orders/OrderTable";
import { ORDER_BOARD_COLUMNS, orderBoardColumn, type OrderBoardColumn } from "@/lib/orders/board";

const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Срок не указан";
const money = (value: number | null | undefined) =>
  `${Math.round(Number(value ?? 0)).toLocaleString("ru-RU")} ₸`;

export default function OrderKanban({
  orders,
  movingIds = new Set<number>(),
  onMove,
}: {
  orders: OrderListItem[];
  movingIds?: Set<number>;
  onMove?: (id: number, column: OrderBoardColumn) => void;
}) {
  return (
    <section aria-label="Канбан заказов" className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <div className="grid min-w-[1180px] grid-cols-4 gap-4 lg:min-w-0">
        {ORDER_BOARD_COLUMNS.map((column) => {
          const columnOrders = column.key === "COMPLETED" ? [] : orders.filter((order) => orderBoardColumn(order.lifecycle) === column.key);
          return (
            <div
              key={column.key}
              data-order-column={column.key}
              onDragOver={(event) => {
                if (!onMove) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                if (!onMove) return;
                event.preventDefault();
                const id = Number(event.dataTransfer.getData("text/order-id"));
                if (Number.isInteger(id) && id > 0) onMove(id, column.key);
              }}
              className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-3 transition-colors hover:border-blue-500/40"
            >
              <header className="mb-3 border-b border-slate-800 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold text-white">{column.label}</h2>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-500/15 text-sm font-bold text-blue-200">{columnOrders.length}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{column.description}</p>
              </header>
              <div className="space-y-3">
                {columnOrders.map((order) => {
                  const moving = movingIds.has(order.id);
                  return (
                  <article
                    key={order.id}
                    draggable={Boolean(onMove) && !moving}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/order-id", String(order.id));
                    }}
                    className={`min-w-0 rounded-xl border border-slate-800 bg-slate-950/80 p-3 transition hover:border-blue-500/60 hover:bg-slate-950 ${onMove && !moving ? "cursor-grab active:cursor-grabbing" : ""} ${moving ? "cursor-wait opacity-60" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/orders/${order.id}`} className="block truncate text-sm font-bold text-blue-200 hover:text-blue-100">{order.number}</Link>
                        <p className="mt-1 truncate font-medium text-white">{order.client.name || "Клиент не указан"}</p>
                      </div>
                      {onMove ? <GripVertical aria-hidden="true" className="shrink-0 text-slate-600" size={18} /> : null}
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                      <p className="flex items-center gap-2"><UserRound size={13}/><span className="truncate">{order.manager || "Ответственный не назначен"}</span></p>
                      <p className="flex items-center gap-2"><CalendarDays size={13}/><span>{date(order.deadline)}</span></p>
                      <p className="flex items-center gap-2 text-slate-300"><CircleDollarSign size={13}/><span>Продажа: {money(order.amount)}</span></p>
                      <p className="flex items-center gap-2 text-amber-200"><WalletCards size={13}/><span>Остаток клиента: {money(order.balance)}</span></p>
                    </div>
                    {order.missingFields?.length ? (
                      <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
                        <p className="flex items-center gap-1 font-semibold"><AlertCircle size={13}/>Нужно дополнить: {order.missingFields.length}</p>
                        <p className="mt-1 leading-5">{order.missingFields.slice(0, 2).join(" · ")}{order.missingFields.length > 2 ? " · ещё…" : ""}</p>
                      </div>
                    ) : null}
                    {onMove ? (
                      <label className="mt-3 block text-xs font-medium text-slate-400 md:hidden">
                        Переместить на этап
                        <select
                          aria-label={`Переместить заказ ${order.number} на этап`}
                          disabled={moving}
                          value={column.key}
                          onChange={(event) => onMove(order.id, event.target.value as OrderBoardColumn)}
                          className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-sm text-white disabled:opacity-50"
                        >
                          {ORDER_BOARD_COLUMNS.map((target) => <option key={target.key} value={target.key}>{target.label}</option>)}
                        </select>
                      </label>
                    ) : null}
                  </article>
                );})}
                {!columnOrders.length ? <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">{column.key === "COMPLETED" ? "Перетащите сюда, чтобы завершить заказ. Закрытые карточки сохраняются в истории." : "Нет заказов"}</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">Перетащите карточку мышью в следующий этап. На телефоне используйте список внутри карточки. Внутренние этапы цеха доступны в разделе «Производство».</p>
    </section>
  );
}
