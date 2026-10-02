"use client";

import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Transition = {
  to: string;
  gate: { passed: boolean; checks: Array<{ code: string; passed: boolean; message: string }> };
};
type Payload = { version: number; transitions: Transition[] };
type Workshop = { id: number; name: string; active?: boolean };

const actionLabels: Record<string, string> = {
  PREPARATION: "Подтвердить договор",
  READY_FOR_PRODUCTION: "Передать в цех",
  IN_PRODUCTION: "Начать производство",
  READY_FOR_INSTALLATION: "Готово к монтажу",
  INSTALLATION: "Начать монтаж",
  ACCEPTANCE: "Перейти к приёмке",
  COMPLETED: "Завершить заказ",
};

const nextLifecycle: Record<string, string | undefined> = {
  CREATED: "PREPARATION",
  PREPARATION: "READY_FOR_PRODUCTION",
  READY_FOR_PRODUCTION: "IN_PRODUCTION",
  IN_PRODUCTION: "READY_FOR_INSTALLATION",
  READY_FOR_INSTALLATION: "INSTALLATION",
  INSTALLATION: "ACCEPTANCE",
  ACCEPTANCE: "COMPLETED",
};

export default function OrderProcess({
  orderId,
  lifecycle,
  version,
  partnerId = null,
  productionPrice = null,
  readOnly = false,
}: {
  orderId: number;
  lifecycle: string;
  version: number;
  partnerId?: number | null;
  productionPrice?: number | string | { toString(): string } | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState<Payload>({ version, transitions: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [rollbackReason, setRollbackReason] = useState("");
  const [workshops, setWorkshops] = useState<Workshop[]>([]);
  const [selectedWorkshopId, setSelectedWorkshopId] = useState(partnerId ? String(partnerId) : "");
  const [selectedProductionPrice, setSelectedProductionPrice] = useState(productionPrice == null ? "" : String(productionPrice));
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

  const naturalNext = nextLifecycle[lifecycle];
  const transition =
    data.transitions.find((item) => item.to === naturalNext) ??
    data.transitions.find((item) => item.to === "COMPLETED");
  const target = transition?.to;
  const rollbackTransition =
    lifecycle === "READY_FOR_PRODUCTION"
      ? data.transitions.find((item) => item.to === "PREPARATION")
      : undefined;
  const transferPrerequisitesPassed = transition?.gate.checks
    .filter((item) => !["WORKSHOP", "PRODUCTION_PRICE"].includes(item.code))
    .every((item) => item.passed) ?? false;

  const loadWorkshops = useCallback(async () => {
    const response = await fetch("/api/partners", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить список цехов");
    const rows = await response.json() as Workshop[];
    setWorkshops(rows.filter((item) => item.active !== false));
  }, []);

  async function requestTransition(selected: Transition, reason?: string) {
    const response = await fetch(`/api/orders/${orderId}/commands`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        action: "transition",
        to: selected.to,
        expectedVersion: data.version,
        ...(reason ? { reason } : {}),
      }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok)
      throw new Error(
        body.error === "GATE_FAILED"
          ? selected.gate.checks
              .filter((item) => !item.passed)
              .map((item) => item.message)
              .join(" · ")
          : body.error === "ROLLBACK_BLOCKED"
            ? "Нельзя вернуть заказ в договор: производство уже начато или цеху была выплата"
          : body.error ?? "Переход недоступен",
      );
  }

  async function run() {
    if (!transition) return;
    if (target === "READY_FOR_PRODUCTION") {
      setError("");
      setTransferOpen(true);
      try { await loadWorkshops(); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить список цехов"); }
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestTransition(transition);
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Переход недоступен");
    } finally {
      setBusy(false);
    }
  }

  async function transferToWorkshop(event: FormEvent) {
    event.preventDefault();
    if (!transition) return;
    const nextWorkshopId = Number(selectedWorkshopId);
    const nextPrice = Number(selectedProductionPrice);
    if (!Number.isInteger(nextWorkshopId) || nextWorkshopId <= 0 || nextPrice < 2) {
      setError("Выберите цех и укажите цену производства");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const assignment = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          action: "assignPartner",
          partnerId: nextWorkshopId,
          partnerPrice: nextPrice,
          directorConfirmed: partnerId !== null && partnerId !== nextWorkshopId,
        }),
      });
      const assignmentBody = await assignment.json() as { error?: string };
      if (!assignment.ok) throw new Error(assignmentBody.error ?? "Не удалось сохранить цех");
      await requestTransition(transition);
      setTransferOpen(false);
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось передать заказ в цех");
    } finally {
      setBusy(false);
    }
  }

  async function returnToContract(event: FormEvent) {
    event.preventDefault();
    const reason = rollbackReason.trim();
    if (!rollbackTransition || !reason) {
      setError("Укажите причину возврата в договор");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await requestTransition(rollbackTransition, reason);
      setRollbackOpen(false);
      setRollbackReason("");
      await load();
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось вернуть заказ в договор");
    } finally {
      setBusy(false);
    }
  }

  if (readOnly || lifecycle === "COMPLETED" || lifecycle === "CANCELLED")
    return null;

  return (
    <div className="flex flex-col items-stretch gap-2 sm:items-end">
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:justify-end">
        {rollbackTransition ? <button type="button" onClick={() => setRollbackOpen((value) => !value)} disabled={busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-600/60 px-4 font-semibold text-amber-100 disabled:opacity-50"><ArrowLeft size={17}/>Вернуть в «Договор»</button> : null}
        {transition && target ? (
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy || (target === "READY_FOR_PRODUCTION" ? !transferPrerequisitesPassed : !transition.gate.passed)}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50 ${target === "COMPLETED" ? "bg-emerald-700" : "bg-blue-600"}`}
          >
            {target === "COMPLETED" ? <CheckCircle2 size={17} /> : null}
            {busy ? "Выполняется…" : actionLabels[target] ?? "Следующий этап"}
            {target !== "COMPLETED" ? <ArrowRight size={17} /> : null}
          </button>
        ) : null}
      </div>
      {rollbackOpen && rollbackTransition ? (
        <form onSubmit={returnToContract} className="w-full max-w-xl rounded-xl border border-amber-700/50 bg-slate-950 p-3 text-left sm:min-w-[420px]">
          <p className="font-semibold text-white">Вернуть заказ в «Договор»</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">Назначенный цех и цена производства будут очищены. Возврат разрешён только пока производство не начато и цеху не было выплат.</p>
          <label className="mt-3 block text-sm text-slate-300">Причина<textarea required value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 p-3 text-white" placeholder="Например: цех ещё не определён" /></label>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRollbackOpen(false)} className="min-h-11 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-white">Отмена</button><button disabled={busy || !rollbackReason.trim()} className="min-h-11 rounded-lg bg-amber-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Возвращаем…" : "Подтвердить возврат"}</button></div>
        </form>
      ) : null}
      {transferOpen && target === "READY_FOR_PRODUCTION" ? (
        <form onSubmit={transferToWorkshop} className="w-full max-w-xl rounded-xl border border-blue-700/60 bg-slate-950 p-3 text-left sm:min-w-[420px]">
          <p className="font-semibold text-white">Передать заказ в цех</p>
          <p className="mt-1 text-xs text-slate-400">Выберите один из добавленных цехов и подтвердите цену производства.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">Цех<select required value={selectedWorkshopId} onChange={(event) => setSelectedWorkshopId(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-white"><option value="">Выберите цех</option>{workshops.map((workshop) => <option key={workshop.id} value={workshop.id}>{workshop.name}</option>)}</select></label>
            <label className="text-sm text-slate-300">Цена производства, ₸<input required type="number" min="2" step="1" value={selectedProductionPrice} onChange={(event) => setSelectedProductionPrice(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 text-white" /></label>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setTransferOpen(false)} className="min-h-11 rounded-lg border border-slate-700 px-4 text-sm font-semibold text-white">Отмена</button><button disabled={busy || !selectedWorkshopId || Number(selectedProductionPrice) < 2} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Передаём…" : "Подтвердить и передать"}</button></div>
        </form>
      ) : null}
      {transition && !transition.gate.passed && !(target === "READY_FOR_PRODUCTION" && transferPrerequisitesPassed) ? (
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
