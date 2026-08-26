"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  ORDER_STAGE_KEYS,
  ORDER_STAGE_LABELS,
  projectOrderStage,
} from "@/lib/orders/presentation";
import { managerOrderBusinessStatus } from "@/lib/orders/manager-attention";

type Transition = {
  to: string;
  gate: {
    passed: boolean;
    checks: Array<{ passed: boolean; message: string }>;
  };
};
type Payload = { version: number; transitions: Transition[] };
const actionLabel: Record<string, string> = {
  PREPARATION: "Замер снят",
  READY_FOR_PRODUCTION: "Передать в заготовку",
  IN_PRODUCTION: "Заготовка завершена",
  READY_FOR_INSTALLATION: "Покраска завершена",
  INSTALLATION: "Начать установку",
  ACCEPTANCE: "Монтаж завершён",
  COMPLETED: "Завершить заказ",
};

export default function OrderProcess({
  orderId,
  lifecycle,
  version,
  contractConfirmed,
  partnerAssigned,
  installationCompleted = false,
  readOnly = false,
}: {
  orderId: number;
  lifecycle: string;
  version: number;
  contractConfirmed: boolean;
  partnerAssigned: boolean;
  installationCompleted?: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [data, setData] = useState<Payload>({ version, transitions: [] });
  const [attention, setAttention] = useState<
    Array<{ message: string; severity: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [measurementOpen, setMeasurementOpen] = useState(false);
  const [measurementDate, setMeasurementDate] = useState(new Date().toISOString().slice(0, 10));
  const [measurementComment, setMeasurementComment] = useState("");
  const manager = session?.user.role === "MANAGER";
  const load = useCallback(async () => {
    const [transitions, signals] = await Promise.all([
      fetch(`/api/orders/${orderId}/available-transitions`),
      fetch(`/api/orders/${orderId}/attention`),
    ]);
    if (transitions.ok) setData((await transitions.json()) as Payload);
    if (signals.ok)
      setAttention(
        (await signals.json()) as Array<{ message: string; severity: string }>,
      );
  }, [orderId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const current = projectOrderStage(lifecycle);
  const currentIndex = ORDER_STAGE_KEYS.indexOf(current);
  const next = data.transitions[0];
  const previous = session?.user.role === "DIRECTOR" ? data.transitions.find((item) => {
    const target = projectOrderStage(item.to);
    return ORDER_STAGE_KEYS.indexOf(target) < currentIndex;
  }) : undefined;
  async function run(target = next, reason?: string, override = false) {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: "transition",
          to: target.to,
          expectedVersion: data.version,
          reason,
          override,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          payload.error === "GATE_FAILED"
            ? target.gate.checks
                .filter((item) => !item.passed)
                .map((item) => item.message)
                .join(" · ")
            : (payload.error ?? "Переход недоступен"),
        );
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Переход недоступен");
    } finally {
      setBusy(false);
    }
  }
  async function completeMeasurement() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ action: "complete-control-measurement", expectedVersion: data.version, completedAt: `${measurementDate}T12:00:00`, comment: measurementComment }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось завершить замер");
      setMeasurementOpen(false); await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось завершить замер"); }
    finally { setBusy(false); }
  }
  async function confirmContract() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/commands`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          action: "confirm-contract",
          expectedVersion: data.version,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось подтвердить договор");
      await load();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось подтвердить договор",
      );
    } finally {
      setBusy(false);
    }
  }
  if (manager) {
    const completed = lifecycle === "COMPLETED";
    const status = managerOrderBusinessStatus({
      lifecycle,
      contractConfirmed,
      partnerAssigned,
      installationCompleted,
    });
    const steps = [
      { label: "Заказ оформлен", done: true },
      { label: "Договор подписан", done: contractConfirmed },
      { label: "Передан в цех", done: partnerAssigned },
      { label: "Заказ завершён", done: completed },
    ];
    const currentIndex = Math.max(
      0,
      steps.findIndex((step) => !step.done),
    );
    return (
      <section id="process" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Статус заказа</h2>
            <p className="mt-1 text-sm text-slate-400">
              Менеджер фиксирует только договор, передачу в цех и сдачу объекта.
            </p>
          </div>
          <span className="self-start rounded-full bg-blue-500/10 px-3 py-1.5 text-sm font-semibold text-blue-200">
            {status}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {steps.map((step, index) => (
            <div
              key={step.label}
              className={`rounded-xl border p-3 text-sm ${step.done ? "border-emerald-900 bg-emerald-500/10 text-emerald-300" : index === currentIndex ? "border-blue-500 bg-blue-500/15 text-blue-200" : "border-slate-800 text-slate-500"}`}
            >
              <span className="block text-xs">
                {step.done ? "✓ Выполнено" : index === currentIndex ? "Сейчас" : "Далее"}
              </span>
              {step.label}
            </div>
          ))}
        </div>
        <p className="mt-4 rounded-xl bg-slate-950/50 p-3 text-sm text-slate-400">
          Заготовку, покраску и другие внутренние этапы ведёт производственный кабинет.
        </p>
        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {!readOnly && !contractConfirmed && (
          <button type="button" disabled={busy} onClick={() => void confirmContract()} className="mt-4 min-h-11 w-full rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50 sm:w-auto">
            {busy ? "Сохранение…" : "Договор подписан"}
          </button>
        )}
        {!readOnly && contractConfirmed && !partnerAssigned && (
          <a href="#settlements" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-amber-300 px-5 font-semibold text-slate-950 sm:w-auto">
            Передать в цех
          </a>
        )}
        {!readOnly && partnerAssigned && !completed && (
          <a href="#completion" className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-emerald-700 px-5 font-semibold text-white sm:w-auto">
            Уточнить: заказ завершён?
          </a>
        )}
      </section>
    );
  }
  return (
    <section id="process" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5">
      <h2 className="text-lg font-semibold text-white">Процесс</h2>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {ORDER_STAGE_KEYS.map((key, index) => (
          <div
            key={key}
            className={`rounded-xl border p-3 text-sm ${index === currentIndex ? "border-blue-500 bg-blue-500/15 text-blue-200" : index < currentIndex ? "border-emerald-900 bg-emerald-500/10 text-emerald-300" : "border-slate-800 text-slate-500"}`}
          >
            <span className="block text-xs">
              {index < currentIndex
                ? "✓ Выполнено"
                : index === currentIndex
                  ? "Сейчас"
                  : "Далее"}
            </span>
            {ORDER_STAGE_LABELS[key]}
          </div>
        ))}
      </div>
      {attention.length > 0 && (
        <div className="mt-4 rounded-xl bg-amber-500/10 p-3">
          <strong className="text-amber-200">Требует внимания</strong>
          {attention.slice(0, 3).map((item, index) => (
            <p
              key={`${item.message}-${index}`}
              className="mt-1 text-sm text-amber-100/80"
            >
              {item.message}
            </p>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-300">
          {error}
        </p>
      )}
      {current === "measurement" && !readOnly && !measurementOpen && (
        <button type="button" onClick={() => setMeasurementOpen(true)} className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white">Замер снят</button>
      )}
      {current === "measurement" && !readOnly && measurementOpen && <div className="mt-4 grid gap-3 rounded-xl border border-blue-500/30 bg-blue-500/5 p-4 sm:grid-cols-2">
        <label className="text-sm text-slate-300">Дата замера<input type="date" required value={measurementDate} onChange={(event) => setMeasurementDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-white"/></label>
        <label className="text-sm text-slate-300">Комментарий<input value={measurementComment} onChange={(event) => setMeasurementComment(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-white"/></label>
        <p className="text-sm text-slate-400 sm:col-span-2">Следующий этап: <strong className="text-white">Заготовка</strong>. Фотографии сохраняются в карточке назначенного замера.</p>
        <div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => void completeMeasurement()} disabled={busy || !measurementDate} className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50">{busy ? "Сохранение…" : "Подтвердить"}</button><button type="button" onClick={() => setMeasurementOpen(false)} className="min-h-11 rounded-xl bg-slate-800 px-4 text-white">Отмена</button></div>
      </div>}
      {next && current !== "measurement" && !readOnly && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !next.gate.passed}
          className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Выполняется…" : (actionLabel[next.to] ?? "Следующий этап")}
        </button>
      )}
      {next && current !== "measurement" && !readOnly && !next.gate.passed && (
        <p className="mt-2 text-sm text-slate-400">
          Сначала:{" "}
          {next.gate.checks
            .filter((item) => !item.passed)
            .map((item) => item.message)
            .join(" · ")}
        </p>
      )}
      {previous && !readOnly && <button type="button" disabled={busy} onClick={() => { const reason = window.prompt("Обязательный комментарий для возврата этапа")?.trim(); if (reason) void run(previous, reason, true); }} className="mt-3 min-h-11 rounded-xl border border-slate-700 px-4 text-sm text-slate-300">Вернуть предыдущий этап</button>}
    </section>
  );
}
