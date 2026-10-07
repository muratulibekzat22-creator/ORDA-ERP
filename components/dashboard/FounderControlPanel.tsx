"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ControlDetail = {
  key: string;
  title: string;
  reason: string;
  action: string;
  href: string;
  assignee: string;
  priority: "URGENT" | "IMPORTANT";
  status: string;
};
type Data = {
  checkedAt: string;
  coverage: { leads: number; orders: number };
  summary: {
    total: number;
    groups: number;
    urgent: number;
    needsOwner: number;
    unacknowledged: number;
    overdue: number;
    completedLast7Days: number;
  };
  issues: Array<{
    key: string;
    title: string;
    href: string;
    assignee: string;
    priority: "URGENT" | "IMPORTANT";
    urgentCount: number;
    details: ControlDetail[];
  }>;
  recentCompleted: Array<{
    id: number;
    title: string;
    completedAt: string;
    href: string;
    assignee: string;
  }>;
};

export default function FounderControlPanel() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  async function load() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/founder/control", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Не удалось проверить ORDA");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка проверки");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <section id="founder-control" className="space-y-3 rounded-2xl border border-amber-700/30 bg-[#101827] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">Контроль исполнения</h2>
          <p className="text-xs text-slate-400">Открытые замечания, срочность и выполненные задания</p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-semibold text-slate-200">
          {open ? "Свернуть" : "Открыть контроль"}
        </button>
      </div>
      {error && <p role="alert" className="text-red-300">{error}</p>}
      {data && !open && (
        <p className="text-sm text-slate-300">
          Направлений контроля: <b>{data.summary.groups}</b> · записей ждут действий: <b className="text-amber-200">{data.summary.total}</b> · выполнено за 7 дней: <b className="text-emerald-300">{data.summary.completedLast7Days}</b>
        </p>
      )}
      {data && open && (
        <>
          <div className="grid gap-2 text-sm sm:grid-cols-3">
            <div className="rounded-xl bg-blue-500/10 p-3 text-blue-100">Направления контроля <b className="block text-2xl">{data.summary.groups}</b></div>
            <div className="rounded-xl bg-amber-500/10 p-3 text-amber-100">Записи ждут действий <b className="block text-2xl">{data.summary.total}</b></div>
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-200">Выполненные задания за 7 дней <b className="block text-2xl">{data.summary.completedLast7Days}</b></div>
          </div>
          <p className="text-xs text-slate-400">
            Срочных записей: {data.summary.urgent} · ждут ознакомления: {data.summary.unacknowledged} · просрочено заданий: {data.summary.overdue} · без ответственного: {data.summary.needsOwner}. Проверено заявок: {data.coverage.leads}; заказов: {data.coverage.orders}.
          </p>
          <p className="text-xs text-slate-500">Проверка: {new Date(data.checkedAt).toLocaleString("ru-RU")}. Замечание исчезает из открытых после исправления исходной карточки.</p>
          <button type="button" disabled={busy} onClick={() => void load()} className="rounded-lg border border-slate-700 px-3 py-2 text-xs disabled:opacity-50">Обновить проверку</button>
          <div className="space-y-2">
            {data.issues.map((group) => (
              <details key={group.key} className="rounded-xl border border-slate-800 bg-slate-950">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-4">
                  <span>
                    <b className="text-white">{group.title}</b>
                    <small className="mt-1 block text-slate-400">{group.assignee} · открыть список и действия</small>
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${group.priority === "URGENT" ? "bg-red-500/15 text-red-200" : "bg-amber-500/15 text-amber-200"}`}>
                    {group.urgentCount ? `Срочно: ${group.urgentCount}` : "Требует внимания"}
                  </span>
                </summary>
                <div className="space-y-2 border-t border-slate-800 p-3">
                  {(expandedGroups[group.key] ? group.details : group.details.slice(0, 10)).map((issue) => (
                    <article key={issue.key} className="rounded-lg bg-slate-900 p-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <Link href={issue.href} className="font-semibold text-sky-300 underline-offset-2 hover:underline">{issue.title}</Link>
                        <span className={issue.priority === "URGENT" ? "font-semibold text-red-300" : "text-amber-200"}>{issue.priority === "URGENT" ? "Срочно" : "Важно"}</span>
                      </div>
                      <p className="mt-1 text-amber-100">{issue.reason}</p>
                      <p className="mt-1 text-slate-300">Что сделать: {issue.action}</p>
                      <p className="mt-2 text-xs text-slate-400">{issue.status} · {issue.assignee}</p>
                    </article>
                  ))}
                  {group.details.length > 10 && (
                    <button
                      type="button"
                      onClick={() => setExpandedGroups((current) => ({ ...current, [group.key]: !current[group.key] }))}
                      className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-sky-300"
                    >
                      {expandedGroups[group.key] ? "Показать первые 10" : `Показать все ${group.details.length} замечаний`}
                    </button>
                  )}
                </div>
              </details>
            ))}
            {!data.issues.length && <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-emerald-200">Открытых замечаний нет.</p>}
          </div>
          <details className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
            <summary className="cursor-pointer font-semibold text-emerald-200">Что выполнено за 7 дней ({data.summary.completedLast7Days})</summary>
            <div className="mt-3 space-y-2">
              {data.recentCompleted.length ? data.recentCompleted.map((task) => (
                <Link key={task.id} href={task.href} className="block rounded-lg bg-slate-950 p-3 text-sm hover:text-white">
                  <b>{task.title}</b><small className="mt-1 block text-slate-400">{task.assignee} · {new Date(task.completedAt).toLocaleString("ru-RU")}</small>
                </Link>
              )) : <p className="text-sm text-slate-400">Выполненных заданий за последние 7 дней пока нет.</p>}
              {data.summary.completedLast7Days > data.recentCompleted.length && <Link href="/calendar?state=completed" className="text-sm font-semibold text-sky-300">Открыть все выполненные задания</Link>}
            </div>
          </details>
        </>
      )}
    </section>
  );
}
