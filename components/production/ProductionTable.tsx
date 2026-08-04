"use client";

import Link from "next/link";

interface Production {
  id: number;

  stage: string;
  percent: number;

  master: string;

  order: {
    id: number;
    number: string;

    client: {
      name: string;
    };
  };
}

interface Props {
  productions: Production[];
}

function stageColor(stage: string) {
  switch (stage) {
    case "Ожидание":
      return "bg-slate-600";

    case "Замер":
      return "bg-yellow-500 text-black";

    case "Производство":
      return "bg-purple-600";

    case "Покраска":
      return "bg-orange-600";

    case "Монтаж":
      return "bg-blue-600";

    case "Готово":
      return "bg-green-600";

    default:
      return "bg-slate-700";
  }
}

export default function ProductionTable({
  productions,
}: Props) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

      <table className="w-full">

        <thead className="bg-slate-900">

          <tr>

            <th className="px-6 py-4 text-left text-slate-300">
              Заказ
            </th>

            <th className="px-6 py-4 text-left text-slate-300">
              Клиент
            </th>

            <th className="px-6 py-4 text-left text-slate-300">
              Этап
            </th>

            <th className="px-6 py-4 text-left text-slate-300">
              Готовность
            </th>

            <th className="px-6 py-4 text-left text-slate-300">
              Мастер
            </th>

            <th className="px-6 py-4 text-left text-slate-300">
              Действия
            </th>

          </tr>

        </thead>

        <tbody>

          {productions.map((item) => (

            <tr
              key={item.id}
              className="border-b border-slate-800 hover:bg-slate-900"
            >

              <td className="px-6 py-4 text-white">
                {item.order.number}
              </td>

              <td className="px-6 py-4 text-white">
                {item.order.client.name}
              </td>

              <td className="px-6 py-4">

                <span
                  className={`rounded-lg px-3 py-2 text-white ${stageColor(item.stage)}`}
                >
                  {item.stage}
                </span>

              </td>

              <td className="px-6 py-4 font-bold text-yellow-400">
                {item.percent}%
              </td>

              <td className="px-6 py-4 text-white">
                {item.master || "-"}
              </td>

              <td className="px-6 py-4">

                <Link
                  href={`/orders/${item.order.id}`}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
                >
                  Открыть
                </Link>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>
  );
}