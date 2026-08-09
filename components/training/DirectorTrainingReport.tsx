"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";

type Row = {
  id: number;
  status: string;
  progressPercent: number;
  bestScore: number;
  bestPercent: number;
  attemptsCount: number;
  lastViewedAt: string | null;
  passedAt: string | null;
  overrideReason: string | null;
  overrideExpiresAt: string | null;
  user: { id: number; name: string; role: string; active: boolean };
  course: { title: string; version: number };
};

const statusName: Record<string, string> = {
  NOT_STARTED: "Не начато",
  IN_PROGRESS: "В процессе",
  READY_FOR_TEST: "Готово к тесту",
  FAILED: "Не пройдено",
  PASSED: "Пройдено",
};

export default function DirectorTrainingReport() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [overrideId, setOverrideId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState("24");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/training/report", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось загрузить отчёт");
    else {
      setRows(body as Row[]);
      setError("");
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const grant = async () => {
    if (!overrideId) return;
    const response = await fetch(`/api/training/assignments/${overrideId}/override`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, hours: Number(hours) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return setError(body.error ?? "Не удалось выдать override");
    setOverrideId(null);
    setReason("");
    await load();
  };

  return (
    <main className="space-y-5 overflow-x-hidden p-4 pb-24 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-blue-300">Сотрудники · Обучение</p>
          <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">Обучение замерщиков</h1>
          <p className="mt-1 text-sm text-slate-400">Фактический просмотр, тестирование и допуск к началу замера.</p>
        </div>
        <button onClick={() => void load()} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4"><RefreshCw size={17} className={loading ? "animate-spin" : ""} /> Обновить</button>
      </header>
      {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-200">{error}</p>}
      <section className="grid gap-3 lg:grid-cols-2">
        {rows.map((row) => (
          <article key={row.id} className="min-w-0 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div><h2 className="text-lg font-semibold text-white">{row.user.name}</h2><p className="text-xs text-slate-500">{row.user.role} · {row.user.active ? "активен" : "неактивен"}</p></div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${row.status === "PASSED" ? "bg-emerald-950 text-emerald-300" : "bg-slate-800 text-slate-300"}`}>{statusName[row.status] ?? row.status}</span>
            </div>
            <p className="mt-3 text-sm text-slate-300">{row.course.title} · версия {row.course.version}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-slate-500">Просмотрено</dt><dd className="mt-1 font-semibold text-white">{Math.round(row.progressPercent)}%</dd></div>
              <div><dt className="text-slate-500">Лучший результат</dt><dd className="mt-1 font-semibold text-white">{row.bestScore}/15 · {Math.round(row.bestPercent)}%</dd></div>
              <div><dt className="text-slate-500">Попыток</dt><dd className="mt-1 font-semibold text-white">{row.attemptsCount}</dd></div>
              <div><dt className="text-slate-500">Последняя активность</dt><dd className="mt-1 font-semibold text-white">{row.lastViewedAt ? new Date(row.lastViewedAt).toLocaleDateString("ru-RU") : "—"}</dd></div>
              <div><dt className="text-slate-500">Дата прохождения</dt><dd className="mt-1 font-semibold text-white">{row.passedAt ? new Date(row.passedAt).toLocaleDateString("ru-RU") : "—"}</dd></div>
              <div><dt className="text-slate-500">Временный допуск</dt><dd className="mt-1 font-semibold text-white">{row.overrideExpiresAt && new Date(row.overrideExpiresAt) > new Date() ? `до ${new Date(row.overrideExpiresAt).toLocaleString("ru-RU")}` : "нет"}</dd></div>
            </dl>
            <button onClick={() => setOverrideId(row.id)} className="mt-4 flex min-h-11 items-center gap-2 rounded-xl border border-amber-700 px-4 text-sm font-semibold text-amber-200"><ShieldCheck size={17} /> Временный override</button>
            {overrideId === row.id && (
              <div className="mt-3 grid gap-3 rounded-xl bg-slate-900 p-3">
                <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Обязательная причина (минимум 10 символов)" className="min-h-24 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 p-3 text-white" />
                <label className="text-sm text-slate-300">Срок, часов<input type="number" min="1" max="72" value={hours} onChange={(event) => setHours(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white" /></label>
                <div className="flex gap-2"><button onClick={() => void grant()} disabled={reason.trim().length < 10} className="min-h-11 flex-1 rounded-xl bg-amber-700 px-3 font-semibold disabled:opacity-50">Выдать допуск</button><button onClick={() => setOverrideId(null)} className="min-h-11 rounded-xl bg-slate-700 px-3">Отмена</button></div>
              </div>
            )}
          </article>
        ))}
        {!loading && !rows.length && <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-slate-400">Назначений обучения пока нет.</p>}
      </section>
    </main>
  );
}
