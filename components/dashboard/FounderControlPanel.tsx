"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
type Data = {
  checkedAt: string; coverage: { leads: number; orders: number };
  summary: { urgent: number; needsOwner: number; unacknowledged: number; overdue: number; verified: number };
  issues: { key: string; title: string; reason: string; action: string; href: string; assignee: string;
    assigneeId: number | null; priority: string; task: null | { id: number; status: string; acknowledgedAt: string | null; resultSubmittedAt: string | null; dueAt: string } }[];
};
export default function FounderControlPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState(false);
  async function load(keys?: string[]) {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/founder/control", keys ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys }) } : { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось проверить ORDA");
      setData(body);
      if (body.result) setMessage(`Назначено: ${body.result.created}. Напоминаний: ${body.result.reminded}. Исправлений подтверждено: ${body.result.verified}.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка проверки"); }
    finally { setBusy(false); }
  }
  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, []);
  const issues = data?.issues ?? [];
  const shown = expanded ? issues : issues.slice(0, 5);
  return <section className="space-y-4 rounded-2xl border border-amber-700/40 bg-[#101827] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-bold">Контроль исполнения</h2><p className="text-sm text-slate-400">Важные отклонения → поручение сотруднику → проверенный результат</p></div>
      <button disabled={busy} onClick={() => void load()} className="rounded-xl border border-slate-600 px-4 py-2">Проверить ORDA</button></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    {data && <><p className="text-sm text-slate-400">Проверено заявок: {data.coverage.leads}; заказов: {data.coverage.orders}. {new Date(data.checkedAt).toLocaleString("ru-RU")}</p>
      <p className="text-sm">Срочно: {data.summary.urgent} · Ждут ознакомления: {data.summary.unacknowledged} · Просрочено: {data.summary.overdue} · Исправлено: {data.summary.verified}</p>
      {data.summary.needsOwner > 0 && <p className="text-amber-300">Нужно ваше решение: назначить ответственного по {data.summary.needsOwner} замечаниям.</p>}
      {shown.map(issue => <article key={issue.key} className="space-y-2 rounded-xl bg-slate-950 p-4">
        <div className="flex flex-wrap justify-between gap-2"><Link href={issue.href} className="font-semibold text-sky-300">{issue.title}</Link><span className="text-sm text-slate-400">{issue.assignee}</span></div>
        <p className="text-sm text-amber-200">{issue.reason}</p><p className="text-sm text-slate-300">{issue.action}</p>
        {issue.task && <p className="text-xs text-slate-400">{issue.task.status === "CANCELLED" ? "Отменено — автоматические напоминания остановлены" : issue.task.resultSubmittedAt || issue.task.status === "COMPLETED" ? "Сотрудник отметил выполнение; отклонение ещё присутствует" : issue.task.acknowledgedAt ? "Ознакомлен, ожидается выполнение" : "Отправлено, ожидается ознакомление"}. Срок: {new Date(issue.task.dueAt).toLocaleString("ru-RU")}</p>}
        {!issue.task && <button disabled={busy || !issue.assigneeId} onClick={() => void load([issue.key])} className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-black disabled:opacity-40">Отправить замечание</button>}
      </article>)}
      {!issues.length && <p className="text-emerald-300">По проверяемым правилам отклонений нет.</p>}
      {issues.length > 5 && <button onClick={() => setExpanded(!expanded)} className="text-sm text-sky-300">{expanded ? "Показать только 5 важных" : `Все отклонения (${issues.length})`}</button>}
      {issues.some(i => !i.task && i.assigneeId) && <button disabled={busy} onClick={() => void load(issues.filter(i => !i.task && i.assigneeId).slice(0, 500).map(i => i.key))} className="block rounded-xl bg-blue-600 px-4 py-3 font-semibold disabled:opacity-40">Назначить все новые замечания</button>}
    </>}
  </section>;
}
