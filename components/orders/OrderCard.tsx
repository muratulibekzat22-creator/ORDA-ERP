"use client";

import Link from "next/link";

interface Props {
  order: any;
}

function statusColor(status: string) {
  switch (status) {
    case "Новая заявка":
      return "bg-blue-600";

    case "Замер":
      return "bg-yellow-500 text-black";

    case "Производство":
      return "bg-purple-600";

    case "Монтаж":
      return "bg-orange-600";

    case "Завершено":
      return "bg-green-600";

    default:
      return "bg-slate-700";
  }
}

export default function OrderCard({ order }: Props) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">
            Заказ {order.number}
          </h2>

          <p className="mt-2 text-slate-400">
            {order.client?.name}
          </p>
        </div>

        <span
          className={`rounded-xl px-4 py-2 text-white ${statusColor(
            order.status
          )}`}
        >
          {order.status}
        </span>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-6">
        <div>
          <p className="text-slate-400">
            Телефон
          </p>

          <p className="text-white">
            {order.client?.phone}
          </p>
        </div>

        <div>
          <p className="text-slate-400">
            Адрес
          </p>

          <p className="text-white">
            {order.address}
          </p>
        </div>

        <div>
          <p className="text-slate-400">
            Материал
          </p>

          <p className="text-white">
            {order.material}
          </p>
        </div>

        <div>
          <p className="text-slate-400">
            Тип лестницы
          </p>

          <p className="text-white">
            {order.staircase}
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Стоимость клиенту
          </p>

          <p className="mt-2 text-3xl font-bold text-green-400">
            {Number(order.amount).toLocaleString()} ₸
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Стоимость партнера
          </p>

          <p className="mt-2 text-3xl font-bold text-blue-400">
            {Number(order.partnerPrice).toLocaleString()} ₸
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Прибыль ALTYN SAPA
          </p>

          <p className="mt-2 text-3xl font-bold text-yellow-400">
            {Number(order.companyProfit).toLocaleString()} ₸
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Выплачено партнеру
          </p>

          <p className="mt-2 text-3xl font-bold text-cyan-400">
            {Number(order.partnerPaid).toLocaleString()} ₸
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Осталось партнеру
          </p>

          <p className="mt-2 text-3xl font-bold text-red-400">
            {Number(order.partnerBalance).toLocaleString()} ₸
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Предоплата клиента
          </p>

          <p className="mt-2 text-3xl font-bold text-cyan-400">
            {Number(order.prepayment).toLocaleString()} ₸
          </p>
        </div>

        <div className="rounded-xl bg-slate-900 p-4">
          <p className="text-slate-400">
            Остаток клиента
          </p>

          <p className="mt-2 text-3xl font-bold text-orange-400">
            {Number(order.balance).toLocaleString()} ₸
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap gap-4">
        <button className="rounded-xl bg-green-600 px-6 py-3 text-white transition hover:bg-green-700">
          Передать партнеру
        </button>

        <Link
          href={`/proposal/${order.id}`}
          className="rounded-xl bg-yellow-500 px-6 py-3 font-semibold text-black transition hover:bg-yellow-400"
        >
          Коммерческое предложение
        </Link>

        <button className="rounded-xl bg-indigo-600 px-6 py-3 text-white transition hover:bg-indigo-700">
          Договор
        </button>

        <Link
          href={`/proposal/${order.id}`}
          target="_blank"
          className="rounded-xl bg-slate-700 px-6 py-3 text-white transition hover:bg-slate-600"
        >
          Печать
        </Link>

        <Link
          href={`/orders/${order.id}`}
          className="rounded-xl bg-blue-600 px-6 py-3 text-white transition hover:bg-blue-700"
        >
          Подробнее
        </Link>
      </div>
    </div>
  );
}