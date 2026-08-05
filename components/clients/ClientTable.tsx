"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown } from "lucide-react";

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
        <h2 className="text-2xl font-bold text-white">Пока нет клиентов</h2>

        <p className="mt-2 text-slate-400">Добавьте первого клиента.</p>
      </div>
    );
  }

  return (
    <>
    <div className="space-y-3 md:hidden">
      {sortedClients.map((client) => <article key={client.id} className="rounded-2xl border border-slate-700 bg-[#101827] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold text-white">{client.name}</h2><a href={`tel:${client.phone}`} className="mt-1 inline-block text-blue-300">{client.phone}</a></div><span className={`shrink-0 rounded-full px-3 py-1 text-xs text-white ${statusClass(client.status)}`}>{client.status}</span></div><dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm"><dt className="text-slate-500">Город</dt><dd className="text-slate-200">{client.city || "—"}</dd><dt className="text-slate-500">Менеджер</dt><dd className="text-slate-200">{client.manager || "—"}</dd><dt className="text-slate-500">Сумма</dt><dd className="font-semibold text-green-400">{Number(client.amount).toLocaleString()} ₸</dd></dl><Link href={`/clients/${client.id}`} className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-white">Открыть клиента</Link></article>)}
    </div>
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827] md:block">
      <table className="w-full min-w-[920px]">
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

            <th className="px-6 py-4 text-center text-slate-300">Действия</th>
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
                    <p className="font-semibold text-white">{client.name}</p>

                    <p className="text-sm text-slate-500">ID #{client.id}</p>
                  </div>
                </div>
              </td>

              <td className="px-6 py-5 text-slate-300">{client.phone}</td>

              <td className="px-6 py-5 text-slate-300">{client.city}</td>

              <td className="px-6 py-5 text-slate-300">{client.manager}</td>

              <td className="px-6 py-5 font-semibold text-green-400">
                {Number(client.amount).toLocaleString()} ₸
              </td>

              <td className="px-6 py-5">
                <span
                  className={`rounded-full px-3 py-1 text-sm text-white ${statusClass(
                    client.status,
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
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}
