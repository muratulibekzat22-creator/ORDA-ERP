"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

interface Order {
  id: number;
  number: string;

  client: {
    name: string;
    phone: string;
  };

  material: string;
  staircase: string;

  amount: string;
  prepayment: string;
  balance: string;

  partnerPrice?: string;
  companyProfit?: string;
  partnerBalance?: string;

  manager: string;
  status: string;
}

interface Props {
  orders: Order[];
}

function statusColor(status: string) {
  switch (status) {
    case "Новая заявка":
      return "bg-blue-600";

    case "Замер":
      return "bg-yellow-500 text-black";

    case "Передано партнеру":
      return "bg-purple-600";

    case "Монтаж":
      return "bg-orange-600";

    case "Завершено":
      return "bg-green-600";

    default:
      return "bg-slate-700";
  }
}

export default function OrderTable({ orders }: Props) {
  const { data: session } = useSession();
  const showInternal = session?.user.role === "DIRECTOR" || session?.user.role === "ACCOUNTANT";
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

      <table className="w-full">

        <thead className="border-b border-slate-700 bg-slate-900">

          <tr>
            <th className="px-4 py-4 text-left text-slate-300">№</th>

            <th className="px-4 py-4 text-left text-slate-300">
              Клиент
            </th>

            <th className="px-4 py-4 text-left text-slate-300">
              Менеджер
            </th>

            <th className="px-4 py-4 text-left text-slate-300">
              Клиент
            </th>

            {showInternal && <th className="px-4 py-4 text-left text-slate-300">Стоимость цеха</th>}

            {showInternal && <th className="px-4 py-4 text-left text-slate-300">Прибыль</th>}

            <th className="px-4 py-4 text-left text-slate-300">
              Остаток
            </th>

            <th className="px-4 py-4 text-left text-slate-300">
              Статус
            </th>

            <th className="px-4 py-4 text-left text-slate-300">
              Действия
            </th>
          </tr>

        </thead>

        <tbody>

          {orders.map((order) => (

            <tr
              key={order.id}
              className="border-b border-slate-800 hover:bg-slate-900 transition"
            >

              <td className="px-4 py-5 font-bold text-white">
                {order.number}
              </td>

              <td className="px-4 py-5">

                <div className="font-semibold text-white">
                  {order.client.name}
                </div>

                <div className="text-sm text-slate-400">
                  {order.client.phone}
                </div>

              </td>

              <td className="px-4 py-5 text-white">
                {order.manager}
              </td>

              <td className="px-4 py-5 font-bold text-green-400">
                {Number(order.amount).toLocaleString()} ₸
              </td>

              {showInternal && <td className="px-4 py-5 font-bold text-blue-400">
                {Number(order.partnerPrice ?? 0).toLocaleString()} ₸
              </td>}

              {showInternal && <td className="px-4 py-5 font-bold text-yellow-400">
                {Number(order.companyProfit ?? 0).toLocaleString()} ₸
              </td>}

              <td className="px-4 py-5 font-bold text-orange-400">
                {Number(order.balance).toLocaleString()} ₸
              </td>

              <td className="px-4 py-5">

                <span
                  className={`rounded-xl px-3 py-2 text-sm text-white ${statusColor(
                    order.status
                  )}`}
                >
                  {order.status}
                </span>

              </td>

              <td className="px-4 py-5">

                <div className="flex gap-2">

                  <Link
                    href={`/orders/${order.id}`}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
                  >
                    Подробнее
                  </Link>

                  <button className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white hover:bg-green-700">
                    КП
                  </button>

                  <button className="rounded-lg bg-yellow-500 px-3 py-2 text-sm text-black hover:bg-yellow-400">
                    Договор
                  </button>

                </div>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>
  );
}
