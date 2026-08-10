"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ORDER_STAGE_KEYS,
  ORDER_STAGE_LABELS,
  projectOrderStage,
} from "@/lib/orders/presentation";

type Transition = {
  to: string;
  gate: {
    passed: boolean;
    checks: Array<{ passed: boolean; message: string }>;
  };
};
type Payload = { version: number; transitions: Transition[] };
const actionLabel: Record<string, string> = {
  PREPARATION: "Начать подготовку",
  READY_FOR_PRODUCTION: "Передать в заготовку",
  IN_PRODUCTION: "Начать заготовку",
  READY_FOR_INSTALLATION: "Завершить покраску",
  INSTALLATION: "Начать установку",
  ACCEPTANCE: "Завершить установку",
  COMPLETED: "Завершить заказ",
};

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
  const [attention, setAttention] = useState<
    Array<{ message: string; severity: string }>
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
  async function run() {
    if (!next) return;
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
          to: next.to,
          expectedVersion: data.version,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          payload.error === "GATE_FAILED"
            ? next.gate.checks
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
  return (
    <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5">
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
      {next && !readOnly && (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !next.gate.passed}
          className="mt-4 min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Выполняется…" : (actionLabel[next.to] ?? "Следующий этап")}
        </button>
      )}
      {next && !readOnly && !next.gate.passed && (
        <p className="mt-2 text-sm text-slate-400">
          Сначала:{" "}
          {next.gate.checks
            .filter((item) => !item.passed)
            .map((item) => item.message)
            .join(" · ")}
        </p>
      )}
    </section>
  );
}
