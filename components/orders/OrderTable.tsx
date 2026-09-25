"use client";

import Link from "next/link";

import {
  USER_ORDER_STATUS_LABELS,
  type UserOrderStatus,
} from "@/lib/orders/presentation";

export type OrderListItem = {
  id: number;
  number: string;
  lifecycle: string;
  userStatus: UserOrderStatus;
  manager: string;
  deadline: string | null;
  amount?: number;
  received?: number;
  balance?: number;
  netProfit?: number | null;
  netMargin?: number | null;
  costDataComplete?: boolean;
  client: { id: number; name: string; phone: string; city: string };
};

const money = (value: number | undefined | null) =>
  value == null ? "—" : `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const date = (value: string | null) =>
  value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "Без срока";

export default function OrderTable({ orders }: { orders: OrderListItem[] }) {
  return (
    <>
      <div className="grid gap-3 lg:hidden">
        {orders.map((order) => (
          <Link
            key={order.id}
            href={`/orders/${order.id}`}
            className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <strong className="block truncate text-white">{order.number}</strong>
                <p className="mt-1 truncate text-sm text-slate-300">{order.client.name || "Клиент не указан"}</p>
                <p className="truncate text-xs text-slate-500">{order.client.phone}</p>
              </div>
              <span className="shrink-0 rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-200">
                {USER_ORDER_STATUS_LABELS[order.userStatus]}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
              <Value label="Ответственный" value={order.manager || "—"} />
              <Value label="Срок" value={date(order.deadline)} />
              {order.amount !== undefined && <Value label="Цена" value={money(order.amount)} />}
              {order.received !== undefined && <Value label="Получено" value={money(order.received)} />}
              {order.balance !== undefined && <Value label="Остаток" value={money(order.balance)} />}
              {order.netProfit !== undefined && (
                <Value
                  label="Чистая прибыль"
                  value={order.netProfit === null ? "Недостаточно данных" : money(order.netProfit)}
                />
              )}
              {order.netMargin !== undefined && (
                <Value
                  label="Маржа"
                  value={order.netMargin === null ? "Недостаточно данных" : `${order.netMargin.toLocaleString("ru-RU")} %`}
                />
              )}
            </div>
          </Link>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-2xl border border-slate-800 bg-[#101827] lg:block">
        <table className="w-full min-w-[1180px] text-left text-sm">
          <thead className="bg-slate-950/60 text-xs uppercase text-slate-500">
            <tr>
              {[
                "Заказ",
                "Клиент",
                "Этап",
                "Ответственный",
                "Срок",
                "Цена клиенту",
                "Получено",
                "Остаток",
                "Чистая прибыль",
                "Маржа",
              ].map((title) => <th key={title} className="px-4 py-3 font-medium">{title}</th>)}
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-t border-slate-800 text-slate-200 hover:bg-slate-900/60">
                <td className="px-4 py-4"><Link href={`/orders/${order.id}`} className="font-semibold text-blue-300 hover:text-blue-200">{order.number}</Link></td>
                <td className="px-4 py-4"><p className="font-medium text-white">{order.client.name || "—"}</p><p className="text-xs text-slate-500">{order.client.phone}</p></td>
                <td className="px-4 py-4"><span className="rounded-full bg-blue-500/10 px-2 py-1 text-xs text-blue-200">{USER_ORDER_STATUS_LABELS[order.userStatus]}</span></td>
                <td className="px-4 py-4">{order.manager || "—"}</td>
                <td className="px-4 py-4">{date(order.deadline)}</td>
                <td className="px-4 py-4">{money(order.amount)}</td>
                <td className="px-4 py-4 text-emerald-300">{money(order.received)}</td>
                <td className="px-4 py-4 text-amber-300">{money(order.balance)}</td>
                <td className="px-4 py-4 font-semibold">{order.netProfit === null ? "Недостаточно данных" : money(order.netProfit)}</td>
                <td className="px-4 py-4">{order.netMargin === null || order.netMargin === undefined ? "Недостаточно данных" : `${order.netMargin.toLocaleString("ru-RU")} %`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Value({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-xl bg-slate-950/60 p-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-medium text-slate-100">{value}</p></div>;
}
