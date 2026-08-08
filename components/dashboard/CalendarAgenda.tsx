"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BUSINESS_TIME_ZONE } from "@/lib/calendar-time";

type Task = { id: number; title: string; dueAt: string; overdue: boolean; client: { name: string } | null; order: { id: number; number: string; client: { name: string } } | null };

export default function CalendarAgenda() {
  const [tasks, setTasks] = useState<Task[]>([]), [error, setError] = useState("");
  useEffect(() => { const now = new Date(), to = new Date(now.getTime() + 7 * 86400000), query = new URLSearchParams({ from: now.toISOString(), to: to.toISOString(), state: "active" }); void fetch(`/api/calendar?${query}`).then(async (response) => { if (!response.ok) throw new Error(); return response.json() as Promise<{ tasks: Task[] }> }).then((data) => setTasks(data.tasks.slice(0, 8))).catch(() => setError("Планировщик временно недоступен")); }, []);
  const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: BUSINESS_TIME_ZONE, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  return <section className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><div className="flex items-center justify-between gap-4"><h2 className="text-2xl font-bold text-white">Ближайшие задачи</h2><Link href="/calendar" className="text-sm text-blue-400">Открыть календарь</Link></div>{error ? <p className="mt-4 text-red-300">{error}</p> : !tasks.length ? <p className="mt-5 text-slate-400">На ближайшие семь дней задач нет.</p> : <div className="mt-5 grid gap-3 md:grid-cols-2">{tasks.map((task) => <Link key={task.id} href={task.order ? `/orders/${task.order.id}` : "/calendar"} className="rounded-xl bg-slate-900 p-4 hover:bg-slate-800"><b className="text-white">{time(task.dueAt)} · {task.title}</b><span className="mt-1 block text-sm text-slate-400">{task.client?.name ?? task.order?.client.name ?? "Без клиента"}</span>{task.overdue && <span className="text-xs text-red-300">Просрочено</span>}</Link>)}</div>}</section>;
}
