"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Measurement = { id: number; status: string; visitDate: string; measurer: string; stepsCount?: number | null; client: { id: number; name: string }; attachments: Array<{ id: number; type: string }> };
const names: Record<string, string> = { ASSIGNED: "Назначен", IN_PROGRESS: "В работе", COMPLETED: "Завершён", HANDED_TO_MANAGER: "Передан менеджеру", CANCELLED: "Отменён" };

export default function ProjectMeasurement({ orderId }: { orderId: number }) {
  const [items, setItems] = useState<Measurement[]>([]), [error, setError] = useState("");
  const load = useCallback(async () => { const response = await fetch(`/api/measurements?orderId=${orderId}`, { cache: "no-store" }), body = await response.json().catch(() => ({})); if (!response.ok) setError(body.error ?? "Не удалось загрузить замеры"); else setItems(body); }, [orderId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-5 text-white"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Замеры</h2><p className="mt-1 text-sm text-slate-400">Новые замеры назначаются из карточки заявки.</p></div><Link href="/measurements" className="rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold">Открыть кабинет замеров</Link></div>{error && <p className="mt-4 text-red-300">{error}</p>}<div className="mt-4 space-y-3">{items.map((row) => <article key={row.id} className="rounded-xl bg-slate-950 p-4"><div className="flex flex-wrap justify-between gap-2"><b>{new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(row.visitDate))}</b><span className="text-sm text-slate-300">{names[row.status] ?? row.status}</span></div><p className="mt-1 text-sm text-slate-400">{row.measurer} · ступеней: {row.stepsCount ?? "—"}</p>{row.attachments.filter((photo) => photo.type === "SHEET").map((photo) => <a key={photo.id} href={`/api/measurement-attachments/${photo.id}`} target="_blank" className="mt-2 inline-block text-sm text-blue-300">Открыть лист замера</a>)}</article>)}{!items.length && !error && <p className="rounded-xl border border-dashed border-slate-700 p-4 text-slate-400">Связанных замеров нет.</p>}</div></section>;
}
