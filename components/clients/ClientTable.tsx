"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, Pencil } from "lucide-react";

import { Client } from "@/lib/types";

interface Props {
  clients: Client[];
}

function statusClass(status: string) {
  switch (status) {
    case "Новый":
      return "bg-blue-600";

    case "В работе":
      return "bg-yellow-500 text-black";

    case "Завершено":
      return "bg-green-600";

    default:
      return "bg-slate-600";
  }
}

export default function ClientTable({ clients }: Props) {
  const [sortBy, setSortBy] = useState<keyof Client>("name");
  const [asc, setAsc] = useState(true);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];

      const comparison = String(av).localeCompare(String(bv));
      return asc ? comparison : -comparison;
    });
  }, [clients, sortBy, asc]);

  function changeSort(field: keyof Client) {
    if (field === sortBy) {
      setAsc(!asc);
      return;
    }

    setSortBy(field);
    setAsc(true);
  }

  if (sortedClients.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-12 text-center">
        <h2 className="text-2xl font-bold text-white">
          Пока нет клиентов
        </h2>

        <p className="mt-2 text-slate-400">
          Добавьте первого клиента.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

      <table className="w-full">

        <thead className="bg-[#172033]">

          <tr className="border-b border-slate-700">

            {[
              ["name", "Клиент"],
              ["phone", "Телефон"],
              ["city", "Город"],
              ["manager", "Менеджер"],
              ["amount", "Сумма"],
              ["status", "Статус"],
            ].map(([field, title]) => (
              <th
                key={field}
                onClick={() => changeSort(field as keyof Client)}
                className="cursor-pointer px-6 py-4 text-left text-slate-300"
              >
                <div className="flex items-center gap-2">
                  {title}
                  <ArrowUpDown size={15} />
                </div>
              </th>
            ))}

            <th className="px-6 py-4 text-center text-slate-300">
              Действия
            </th>

          </tr>

        </thead>

        <tbody>

          {sortedClients.map((client) => (

            <tr
              key={client.id}
              className="border-b border-slate-800 transition hover:bg-[#1A2338]"
            >

              <td className="px-6 py-5">

                <div className="flex items-center gap-3">

                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-600 text-lg font-bold text-white">
                    {client.name.charAt(0).toUpperCase()}
                  </div>

                  <div>

                    <p className="font-semibold text-white">
                      {client.name}
                    </p>

                    <p className="text-sm text-slate-500">
                      ID #{client.id}
                    </p>

                  </div>

                </div>

              </td>

              <td className="px-6 py-5 text-slate-300">
                {client.phone}
              </td>

              <td className="px-6 py-5 text-slate-300">
                {client.city}
              </td>

              <td className="px-6 py-5 text-slate-300">
                {client.manager}
              </td>

              <td className="px-6 py-5 font-semibold text-green-400">
                {Number(client.amount).toLocaleString()} ₸
              </td>

              <td className="px-6 py-5">

                <span
                  className={`rounded-full px-3 py-1 text-sm text-white ${statusClass(
                    client.status
                  )}`}
                >
                  {client.status}
                </span>

              </td>

              <td className="px-6 py-5">

                <div className="flex justify-center gap-2">

                  <Link
                    href={`/clients/${client.id}`}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-white transition hover:bg-blue-700"
                  >
                    Открыть
                  </Link>

                  <button className="rounded-lg bg-slate-700 p-2 text-white transition hover:bg-slate-600">
                    <Pencil size={18} />
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
