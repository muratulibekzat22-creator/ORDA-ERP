"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  USER_ORDER_STATUS_LABELS,
  projectOrderStatus,
} from "@/lib/orders/presentation";

type Transition = {
  to: string;
  gate: { passed: boolean; checks: Array<{ passed: boolean; message: string }> };
};
type Payload = { version: number; transitions: Transition[] };

export default function OrderProcess({
  orderId,
  lifecycle,
  version,
  readOnly = false,
}: {
  orderId: number;
  lifecycle: string;
  version: number;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<Payload>({ version, transitions: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [measurementDate, setMeasurementDate] = useState(new Date().toISOString().slice(0, 10));
  const [measurementComment, setMeasurementComment] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/orders/${orderId}/available-transitions`, { cache: "no-store" });
    if (response.ok) setData((await response.json()) as Payload);
  }, [orderId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const next = data.transitions.find((item) => item.to !== "CANCELLED");
  const nextLabel = next
    ? USER_ORDER_STATUS_LABELS[projectOrderStatus(next.to)]
    : null;
  async function run() {
    if (!next) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "transition", to: next.to, expectedVersion: data.version }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error === "GATE_FAILED" ? next.gate.checks.filter((item) => !item.passed).map((item) => item.message).join(" · ") : body.error ?? "Переход недоступен");
      await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Переход недоступен"); }
    finally { setBusy(false); }
  }
  async function completeMeasurement() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "complete-control-measurement", expectedVersion: data.version, completedAt: `${measurementDate}T12:00:00`, comment: measurementComment }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось зафиксировать замер");
      setMeasurementOpen(false); await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось зафиксировать замер"); }
    finally { setBusy(false); }
  }
  if (readOnly || lifecycle === "COMPLETED" || lifecycle === "CANCELLED") return null;
  return <div>
    {lifecycle === "CREATED" ? <>
      <button type="button" onClick={() => setMeasurementOpen(true)} disabled={busy} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50 sm:w-auto">Следующий этап <ArrowRight size={17}/></button>
      {measurementOpen && <div className="mt-3 grid gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 sm:grid-cols-2">
        <label className="text-sm text-slate-300">Дата контрольного замера<input type="date" required value={measurementDate} onChange={(event) => setMeasurementDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-white"/></label>
        <label className="text-sm text-slate-300">Комментарий<input value={measurementComment} onChange={(event) => setMeasurementComment(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-white"/></label>
        <div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => void completeMeasurement()} disabled={busy || !measurementDate} className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold disabled:opacity-50">{busy ? "Сохранение…" : "Подтвердить"}</button><button type="button" onClick={() => setMeasurementOpen(false)} className="min-h-11 rounded-xl bg-slate-800 px-4">Отмена</button></div>
      </div>}
    </> : next ? <div className="flex flex-col items-stretch gap-2 sm:items-end"><button type="button" onClick={() => void run()} disabled={busy || !next.gate.passed} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Выполняется…" : "Следующий этап"}<ArrowRight size={17}/></button>{nextLabel && <span className="text-xs text-slate-400">Далее: {nextLabel}</span>}</div> : null}
    {next && !next.gate.passed && <p className="mt-2 text-sm text-amber-200">Сначала: {next.gate.checks.filter((item) => !item.passed).map((item) => item.message).join(" · ")}</p>}
    {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
  </div>;
}
