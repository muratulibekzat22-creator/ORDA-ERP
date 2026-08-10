"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpDown, MoreVertical, RotateCcw, Ruler, Trash2 } from "lucide-react";

import { Client } from "@/lib/types";

interface Props {
  clients: Client[];
  deletedView?: boolean;
  onDelete: (client: Client) => void;
  onRestore: (client: Client) => void;
}

function statusClass(status: string) {
  if (status === "Новый") return "bg-blue-600";
  if (status === "В работе") return "bg-yellow-500 text-black";
  if (status === "Завершено") return "bg-green-600";
  return "bg-slate-600";
}

function Actions({ client, deletedView, onDelete, onRestore }: { client: Client; deletedView: boolean; onDelete: (client: Client) => void; onRestore: (client: Client) => void }) {
  return <details className="relative">
    <summary aria-label={`Действия с заявкой ${client.name || client.phone}`} className="flex h-11 w-11 cursor-pointer list-none items-center justify-center rounded-xl bg-slate-800 text-white [&::-webkit-details-marker]:hidden"><MoreVertical size={19} /></summary>
    <div className="absolute right-0 z-30 mt-2 w-60 rounded-xl border border-slate-700 bg-slate-950 p-2 text-left shadow-2xl">
      <Link href={`/clients/${client.id}`} className="flex min-h-11 items-center rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800">Открыть / редактировать</Link>
      {!deletedView && <Link href={`/clients/${client.id}#measurement-scheduling`} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"><Ruler size={16} />Назначить замер</Link>}
      {deletedView ? <button type="button" onClick={() => onRestore(client)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-emerald-300 hover:bg-emerald-950/40"><RotateCcw size={16} />Восстановить заявку</button> : <button type="button" onClick={() => onDelete(client)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-red-300 hover:bg-red-950/40"><Trash2 size={16} />Удалить заявку</button>}
    </div>
  </details>;
}

export default function ClientTable({ clients, deletedView = false, onDelete, onRestore }: Props) {
  const [sortBy, setSortBy] = useState<keyof Client>("name"), [asc, setAsc] = useState(true);
  const sortedClients = useMemo(() => [...clients].sort((a, b) => { const comparison = String(a[sortBy]).localeCompare(String(b[sortBy])); return asc ? comparison : -comparison; }), [clients, sortBy, asc]);
  function changeSort(field: keyof Client) { if (field === sortBy) { setAsc(!asc); return; } setSortBy(field); setAsc(true); }

  return <>
    <div className="space-y-3 md:hidden">{sortedClients.map((client) => <article key={client.id} className="min-w-0 rounded-2xl border border-slate-700 bg-[#101827] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-semibold text-white">{client.name || client.phone}</h2><a href={`tel:${client.phone}`} className="mt-1 inline-block break-all text-blue-300">{client.phone}</a></div><Actions client={client} deletedView={deletedView} onDelete={onDelete} onRestore={onRestore} /></div><dl className="mt-4 grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm"><dt className="text-slate-500">Город</dt><dd className="break-words text-slate-200">{client.city || "—"}</dd><dt className="text-slate-500">Менеджер</dt><dd className="break-words text-slate-200">{client.manager || "—"}</dd><dt className="text-slate-500">Источник</dt><dd className="break-words text-slate-200">{client.source || "—"}</dd><dt className="text-slate-500">Заказы</dt><dd className="text-slate-200">{client._count?.orders ?? 0}</dd></dl><Link href={`/clients/${client.id}`} className="mt-4 flex min-h-11 items-center justify-center rounded-xl bg-blue-600 px-4 text-white">Открыть заявку</Link></article>)}</div>
    <div className="hidden overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827] md:block"><table className="w-full min-w-[920px]"><thead className="bg-[#172033]"><tr className="border-b border-slate-700">{[["name", "Клиент"], ["phone", "Телефон"], ["city", "Город"], ["manager", "Менеджер"], ["source", "Источник"], ["status", "Статус"]].map(([field, title]) => <th key={field} onClick={() => changeSort(field as keyof Client)} className="cursor-pointer px-6 py-4 text-left text-slate-300"><div className="flex items-center gap-2">{title}<ArrowUpDown size={15} /></div></th>)}<th className="px-6 py-4 text-center text-slate-300">Действия</th></tr></thead><tbody>{sortedClients.map((client) => <tr key={client.id} className="border-b border-slate-800 transition hover:bg-[#1A2338]"><td className="px-6 py-5 font-semibold text-white">{client.name || client.phone}</td><td className="px-6 py-5 text-slate-300">{client.phone}</td><td className="px-6 py-5 text-slate-300">{client.city}</td><td className="px-6 py-5 text-slate-300">{client.manager}</td><td className="px-6 py-5 text-slate-300">{client.source || "—"}</td><td className="px-6 py-5"><span className={`rounded-full px-3 py-1 text-sm text-white ${statusClass(client.status)}`}>{client.status}</span></td><td className="px-6 py-5"><div className="flex justify-center"><Actions client={client} deletedView={deletedView} onDelete={onDelete} onRestore={onRestore} /></div></td></tr>)}</tbody></table></div>
  </>;
}
