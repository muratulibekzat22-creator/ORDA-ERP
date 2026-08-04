"use client";

interface Order {
  id: number;
  number: string;
  status: string;
  amount: string;

  client: {
    name: string;
    phone: string;
    city: string;
  };
}

interface Props {
  orders: Order[];
}

const columns = [
  "Новая заявка",
  "Связались",
  "Назначен замер",
  "Замер выполнен",
  "КП отправлено",
  "Договор подписан",
  "Производство",
  "Монтаж",
  "Завершено",
];

function color(status: string) {
  switch (status) {
    case "Новая заявка":
      return "border-blue-500";
    case "Связались":
      return "border-cyan-500";
    case "Назначен замер":
      return "border-yellow-500";
    case "Замер выполнен":
      return "border-orange-500";
    case "КП отправлено":
      return "border-purple-500";
    case "Договор подписан":
      return "border-green-500";
    case "Производство":
      return "border-pink-500";
    case "Монтаж":
      return "border-indigo-500";
    default:
      return "border-emerald-500";
  }
}

export default function KanbanBoard({
  orders,
}: Props) {
  return (
    <div className="flex gap-5 overflow-x-auto pb-4">

      {columns.map((column) => (

        <div
          key={column}
          className="min-w-[320px] rounded-2xl border border-slate-700 bg-[#101827] p-4"
        >

          <div className="mb-5 flex items-center justify-between">

            <h2 className="font-bold text-white">
              {column}
            </h2>

            <span className="rounded-lg bg-slate-900 px-3 py-1 text-sm text-slate-300">
              {
                orders.filter(
                  (item) => item.status === column
                ).length
              }
            </span>

          </div>

          <div className="space-y-4">

            {orders
              .filter(
                (item) => item.status === column
              )
              .map((order) => (

                <div
                  key={order.id}
                  className={`rounded-xl border-l-4 ${color(
                    order.status
                  )} bg-slate-900 p-4`}
                >

                  <div className="flex items-center justify-between">

                    <h3 className="font-bold text-white">
                      {order.number}
                    </h3>

                    <span className="text-green-400 font-bold">
                      {Number(order.amount).toLocaleString()} ₸
                    </span>

                  </div>

                  <p className="mt-3 text-white">
                    {order.client.name}
                  </p>

                  <p className="text-sm text-slate-400">
                    {order.client.phone}
                  </p>

                  <p className="text-sm text-slate-500">
                    {order.client.city}
                  </p>

                  <button
                    className="mt-5 w-full rounded-xl bg-blue-600 py-2 text-white hover:bg-blue-700"
                  >
                    Открыть
                  </button>

                </div>

              ))}

          </div>

        </div>

      ))}

    </div>
  );
}