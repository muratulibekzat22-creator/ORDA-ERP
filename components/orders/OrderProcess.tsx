"use client";

import { ArrowRight, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Transition = {
  to: string;
  gate: { passed: boolean; checks: Array<{ passed: boolean; message: string }> };
};
type Payload = { version: number; transitions: Transition[] };

const actionLabels: Record<string, string> = {
  PREPARATION: "Подтвердить договор",
  READY_FOR_PRODUCTION: "Передать в цех",
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch(`/api/orders/${orderId}/available-transitions`, {
      cache: "no-store",
    });
    if (response.ok) setData((await response.json()) as Payload);
  }, [orderId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const target =
    lifecycle === "CREATED"
      ? "PREPARATION"
      : lifecycle === "PREPARATION"
        ? "READY_FOR_PRODUCTION"
        : "COMPLETED";
  const transition = data.transitions.find((item) => item.to === target);

  async function run() {
    if (!transition) return;
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
          to: transition.to,
          expectedVersion: data.version,
        }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(
          body.error === "GATE_FAILED"
            ? transition.gate.checks
                .filter((item) => !item.passed)
                .map((item) => item.message)
                .join(" · ")
            : body.error ?? "Переход недоступен",
        );
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Переход недоступен");
    } finally {
      setBusy(false);
    }
  }

  if (readOnly || lifecycle === "COMPLETED" || lifecycle === "CANCELLED")
    return null;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      {transition ? (
        <button
          type="button"
          onClick={() => void run()}
          disabled={busy || !transition.gate.passed}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${target === "COMPLETED" ? "bg-emerald-700" : "bg-blue-600"}`}
        >
          {target === "COMPLETED" ? <CheckCircle2 size={17} /> : null}
          {busy ? "Выполняется…" : actionLabels[target]}
          {target !== "COMPLETED" ? <ArrowRight size={17} /> : null}
        </button>
      ) : null}
      {transition && !transition.gate.passed ? (
        <p className="max-w-xl text-sm text-amber-200">
          Нужно заполнить: {transition.gate.checks
            .filter((item) => !item.passed)
            .map((item) => item.message)
            .join(" · ")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      ) : null}
    </div>
  );
}
