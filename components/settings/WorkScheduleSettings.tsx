"use client";

import { useCallback, useEffect, useState } from "react";

import { WEEKDAY_OPTIONS } from "@/lib/work-schedule";

type WorkSchedule = {
  weeklyDayOff: number;
  weeklyDayOffLabel: string;
  cancelledReportTasks?: number;
};

export default function WorkScheduleSettings() {
  const [data, setData] = useState<WorkSchedule | null>(null);
  const [weeklyDayOff, setWeeklyDayOff] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/settings/work-schedule", { cache: "no-store" });
      const payload = await response.json() as WorkSchedule & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить настройку");
      setData(payload);
      setWeeklyDayOff(payload.weeklyDayOff);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить настройку");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/settings/work-schedule", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklyDayOff }),
      });
      const payload = await response.json() as WorkSchedule & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить настройку");
      setData(payload);
      setWeeklyDayOff(payload.weeklyDayOff);
      setMessage(payload.cancelledReportTasks
        ? `Сохранено. Отменено обязательных отчётов за выходной: ${payload.cancelledReportTasks}.`
        : "Рабочий календарь сохранён.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить настройку");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
      <div className="max-w-3xl">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-300">Рабочий календарь</p>
        <h2 className="mt-1 text-xl font-bold text-white">Еженедельный выходной</h2>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          За выбранный день ORDA сохраняет фактические показатели, но не создаёт обязательный ежедневный CRM‑отчёт. В кабинетах будет указано «Выходной — отчёт не нужен».
        </p>
      </div>
      {error ? <p role="alert" className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
      {message ? <p className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">{message}</p> : null}
      <div className="mt-5 grid max-w-2xl gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="block text-sm text-slate-300">
          Выходной день
          <select
            value={weeklyDayOff}
            disabled={loading || saving}
            onChange={(event) => setWeeklyDayOff(Number(event.target.value))}
            className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white disabled:opacity-60"
          >
            {WEEKDAY_OPTIONS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={loading || saving || weeklyDayOff === data?.weeklyDayOff}
          onClick={() => void save()}
          className="min-h-12 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "Сохранить"}
        </button>
      </div>
      <p className="mt-3 text-xs text-slate-500">Сейчас: {data?.weeklyDayOffLabel ?? (loading ? "загрузка…" : "не определён")}.</p>
    </section>
  );
}
