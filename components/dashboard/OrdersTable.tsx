import Link from "next/link";

const orders = [
  {
    id: "AS-001",
    client: "ТОО Астана Дом",
    city: "Астана",
    manager: "Бекзат",
    partner: "Алматы Лестница",
    amount: 4800000,
    paid: 2000000,
    balance: 2800000,
    status: "В производстве",
  },
  {
    id: "AS-002",
    client: "Restaurant Talgar",
    city: "Алматы",
    manager: "Нурсултан",
    partner: "Talgar Wood",
    amount: 2650000,
    paid: 1000000,
    balance: 1650000,
    status: "Замер",
  },
  {
    id: "AS-003",
    client: "Villa House",
    city: "Шымкент",
    manager: "Ерлан",
    partner: "Premium Stair",
    amount: 6200000,
    paid: 4200000,
    balance: 2000000,
    status: "Монтаж",
  },
];

function statusColor(status: string) {
  switch (status) {
    case "Замер":
      return "bg-yellow-500 text-black";

    case "В производстве":
      return "bg-purple-600 text-white";

    case "Монтаж":
      return "bg-orange-600 text-white";

    case "Завершено":
      return "bg-green-600 text-white";

    default:
      return "bg-blue-600 text-white";
  }
}

export default function OrdersTable() {
  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

      <div className="flex items-center justify-between border-b border-slate-700 p-6">

        <div>

          <h2 className="text-2xl font-bold text-white">
            Последние заказы
          </h2>

          <p className="mt-1 text-slate-400">
            Последние созданные договоры
          </p>

        </div>

        <Link
          href="/orders"
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          Все заказы
        </Link>

      </div>

      <table className="w-full">

        <thead className="bg-slate-900">

          <tr>

            <th className="px-6 py-4 text-left text-slate-400">
              №
            </th>

            <th className="px-6 py-4 text-left text-slate-400">
              Клиент
            </th>

            <th className="px-6 py-4 text-left text-slate-400">
              Город
            </th>

            <th className="px-6 py-4 text-left text-slate-400">
              Менеджер
            </th>

            <th className="px-6 py-4 text-left text-slate-400">
              Партнер
            </th>

            <th className="px-6 py-4 text-right text-slate-400">
              Сумма
            </th>

            <th className="px-6 py-4 text-right text-slate-400">
              Оплачено
            </th>

            <th className="px-6 py-4 text-right text-slate-400">
              Остаток
            </th>

            <th className="px-6 py-4 text-center text-slate-400">
              Статус
            </th>

          </tr>

        </thead>

        <tbody>

          {orders.map((order) => (

            <tr
              key={order.id}
              className="border-t border-slate-800 hover:bg-slate-900"
            >

              <td className="px-6 py-5 font-semibold text-white">
                {order.id}
              </td>

              <td className="px-6 py-5 text-white">
                {order.client}
              </td>

              <td className="px-6 py-5 text-slate-300">
                {order.city}
              </td>

              <td className="px-6 py-5 text-slate-300">
                {order.manager}
              </td>

              <td className="px-6 py-5 text-cyan-400">
                {order.partner}
              </td>

              <td className="px-6 py-5 text-right font-bold text-green-400">
                {order.amount.toLocaleString()} ₸
              </td>

              <td className="px-6 py-5 text-right font-bold text-blue-400">
                {order.paid.toLocaleString()} ₸
              </td>

              <td className="px-6 py-5 text-right font-bold text-orange-400">
                {order.balance.toLocaleString()} ₸
              </td>

              <td className="px-6 py-5 text-center">

                <span
                  className={`rounded-full px-3 py-1 text-sm ${statusColor(
                    order.status
                  )}`}
                >
                  {order.status}
                </span>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>
  );
}