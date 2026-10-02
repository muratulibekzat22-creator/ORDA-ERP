"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
type Data = {
  checkedAt: string; coverage: { leads: number; orders: number };
  summary: { total: number; groups: number; urgent: number; needsOwner: number; unacknowledged: number; overdue: number; verified: number };
  issues: { key: string; title: string; reason: string; action: string; href: string; assignee: string;
    assigneeId: number | null; priority: string; task: null | { id: number; status: string; acknowledgedAt: string | null; resultSubmittedAt: string | null; dueAt: string } }[];
};
export default function FounderControlPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  async function load() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/founder/control", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось проверить ORDA");
      setData(body);
      setMessage("");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки"); }
    finally { setBusy(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, []);
  const issues = data?.issues ?? [];
  const shown = expanded ? issues : issues.slice(0, 5);
  return <section className="space-y-2 rounded-2xl border border-amber-700/30 bg-[#101827] p-3">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-bold">Контроль исполнения</h2><p className="text-xs text-slate-400">Только отклонения, которые требуют внимания</p></div>
      <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200">{open ? "Свернуть" : "Открыть контроль"}</button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    {data && <>
      {!open && <p className="text-xs text-slate-400">Сводных групп: <span className="font-semibold text-amber-200">{data.summary.groups}</span> · ждут реакции сотрудников: {data.summary.unacknowledged}</p>}
      {open && <><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-red-500/10 px-3 py-1.5 text-red-200">Сводных групп: {data.summary.groups}</span><span className="rounded-full bg-amber-500/10 px-3 py-1.5 text-amber-200">Ждут ознакомления: {data.summary.unacknowledged}</span><span className="rounded-full bg-slate-900 px-3 py-1.5 text-slate-300">Просрочено: {data.summary.overdue}</span><span className="rounded-full bg-emerald-500/10 px-3 py-1.5 text-emerald-200">Исправлено: {data.summary.verified}</span></div>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-500">Проверено заявок: {data.coverage.leads}; заказов: {data.coverage.orders}. {new Date(data.checkedAt).toLocaleString("ru-RU")}</p><button disabled={busy} onClick={() => void load()} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Обновить проверку</button></div>
      <p className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-sm text-blue-100">Сотрудникам не отправляются сотни отдельных уведомлений. ORDA объединяет замечания в ежедневное задание менеджеру, а директор контролирует реакцию и результат.</p>
      {data.summary.needsOwner > 0 && <p className="text-amber-300">Директору нужно распределить ответственных по {data.summary.needsOwner} отклонениям.</p>}
      {shown.map(issue => <article key={issue.key} className="space-y-2 rounded-xl bg-slate-950 p-4">
        <div className="flex flex-wrap justify-between gap-2"><Link href={issue.href} className="font-semibold text-sky-300">{issue.title}</Link><span className="text-sm text-slate-400">{issue.assignee}</span></div>
        <p className="text-sm text-amber-200">{issue.reason}</p><p className="text-sm text-slate-300">{issue.action}</p>
      </article>)}
      {!issues.length && <p className="text-emerald-300">По проверяемым правилам отклонений нет.</p>}
      {issues.length > 5 && <button onClick={() => setExpanded(!expanded)} className="text-sm text-sky-300">{expanded ? "Показать только 5 важных" : `Все отклонения (${issues.length})`}</button>}
      </>}
    </>}
  </section>;
}
