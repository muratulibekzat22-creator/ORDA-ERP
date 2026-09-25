"use client";

import { AlertCircle, CalendarDays, UserRound } from "lucide-react";
import Link from "next/link";

import type { OrderListItem } from "@/components/orders/OrderTable";
import { ORDER_BOARD_COLUMNS, orderBoardColumn } from "@/lib/orders/board";
import { USER_ORDER_STATUS_LABELS } from "@/lib/orders/presentation";

const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Срок не указан";

export default function OrderKanban({ orders }: { orders: OrderListItem[] }) {
  return (
    <section aria-label="Канбан заказов" className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0">
      <div className="grid min-w-[1180px] grid-cols-4 gap-4 lg:min-w-0">
        {ORDER_BOARD_COLUMNS.map((column) => {
          const columnOrders = orders.filter((order) => orderBoardColumn(order.lifecycle) === column.key);
          return (
            <div key={column.key} className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-3">
              <header className="mb-3 border-b border-slate-800 pb-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="font-bold text-white">{column.label}</h2>
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-500/15 text-sm font-bold text-blue-200">{columnOrders.length}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{column.description}</p>
              </header>
              <div className="space-y-3">
                {columnOrders.map((order) => (
                  <Link key={order.id} href={`/orders/${order.id}`} className="block min-w-0 rounded-xl border border-slate-800 bg-slate-950/80 p-3 transition hover:border-blue-500/60 hover:bg-slate-950">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <strong className="block truncate text-sm text-blue-200">{order.number}</strong>
                        <p className="mt-1 truncate font-medium text-white">{order.client.name || "Клиент не указан"}</p>
                      </div>
                      {column.key === "WORKSHOP" ? <span className="shrink-0 rounded-full bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-200">{USER_ORDER_STATUS_LABELS[order.userStatus]}</span> : null}
                    </div>
                    <div className="mt-3 space-y-1.5 text-xs text-slate-400">
                      <p className="flex items-center gap-2"><UserRound size={13}/><span className="truncate">{order.manager || "Ответственный не назначен"}</span></p>
                      <p className="flex items-center gap-2"><CalendarDays size={13}/><span>{date(order.deadline)}</span></p>
                    </div>
                    {order.missingFields?.length ? (
                      <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-xs text-amber-200">
                        <p className="flex items-center gap-1 font-semibold"><AlertCircle size={13}/>Нужно дополнить: {order.missingFields.length}</p>
                        <p className="mt-1 leading-5">{order.missingFields.slice(0, 2).join(" · ")}{order.missingFields.length > 2 ? " · ещё…" : ""}</p>
                      </div>
                    ) : null}
                  </Link>
                ))}
                {!columnOrders.length ? <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">Нет заказов</p> : null}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-slate-500">Откройте карточку заказа, чтобы заполнить данные или уточнить этап внутри цеха.</p>
    </section>
  );
}
