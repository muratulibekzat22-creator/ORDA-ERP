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

      <div className="space-y-3 p-3 md:hidden">
        {productions.map((item) => (
          <article key={item.id} className="rounded-xl border border-slate-700 bg-slate-900 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-slate-500">Заказ {item.order.number}</p>
                <h2 className="mt-1 break-words font-semibold text-white">{item.order.client.name}</h2>
              </div>
              <span className={`shrink-0 rounded-lg px-2 py-1 text-xs text-white ${stageColor(item.stage)}`}>
                {item.stage}
              </span>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800" aria-label={`Готовность ${item.percent}%`}>
              <div className="h-full rounded-full bg-yellow-400" style={{ width: `${Math.min(100, Math.max(0, item.percent))}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between text-sm">
              <span className="text-slate-400">{item.master || "Мастер не назначен"}</span>
              <strong className="text-yellow-300">{item.percent}%</strong>
            </div>
            <Link href={`/orders/${item.order.id}`} className="mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500">
              Открыть заказ
            </Link>
          </article>
        ))}
      </div>

      <table className="hidden w-full md:table">

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
