"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AgendaEvent = { id: string; orderId: number; title: string; startDate: string; client: string };

export default function CalendarAgenda() {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetch("/api/calendar").then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить планировщик");
        return response.json() as Promise<{ events: AgendaEvent[] }>;
      }).then((data) => setEvents(data.events)).catch(() => setError("Планировщик временно недоступен"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const groups = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const week = new Date(today); week.setDate(today.getDate() + 7);
    return [{ title: "Сегодня", from: today, to: tomorrow }, { title: "Завтра", from: tomorrow, to: new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate() + 1) }, { title: "На неделю", from: today, to: week }].map((group) => ({ ...group, events: events.filter((event) => { const date = new Date(event.startDate); return date >= group.from && date < group.to; }) }));
  }, [events]);
  return <section className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><div className="flex items-center justify-between"><h2 className="text-2xl font-bold text-white">Планировщик</h2><Link href="/calendar" className="text-sm text-blue-400 hover:text-blue-300">Открыть календарь</Link></div>{error ? <p className="mt-4 text-red-300">{error}</p> : <div className="mt-5 grid gap-5 lg:grid-cols-3">{groups.map((group) => <div key={group.title} className="rounded-xl bg-slate-900 p-4"><h3 className="font-semibold text-white">{group.title}</h3><div className="mt-3 space-y-2">{group.events.length === 0 ? <p className="text-sm text-slate-500">Нет событий</p> : group.events.map((event) => <Link key={event.id} href={`/orders/${event.orderId}`} className="block rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"><b>{event.title}</b><br/><span className="opacity-80">{event.client}</span></Link>)}</div></div>)}</div>}</section>;
}
