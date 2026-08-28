"use client";

import { CheckCircle2, CircleDollarSign, PackageCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useState } from "react";

import type { OrderTabData } from "./tabs/types";

type CompletionOrder = Pick<
  OrderTabData,
  "id" | "lifecycle" | "completedAt" | "financialClosedAt" | "settlement"
>;

const control =
  "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white";
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default function OrderCompletionPanel({
  order,
  readOnly = false,
}: {
  order: CompletionOrder;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";
  const [open, setOpen] = useState(searchParams.get("action") === "complete");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completedAt, setCompletedAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [comment, setComment] = useState("");
  const [clientAccepted, setClientAccepted] = useState(true);
  const [contactConsent, setContactConsent] = useState("UNKNOWN");
  const [photoVideoConsent, setPhotoVideoConsent] = useState("UNKNOWN");
  const [photo, setPhoto] = useState<File | null>(null);
  const [video, setVideo] = useState<File | null>(null);
  const operationallyCompleted = order.lifecycle === "COMPLETED";
  const clientRemaining = order.settlement?.client?.remaining ?? 0;
  const partnerRemaining = order.settlement?.partner?.remaining ?? 0;
  const payrollRemaining =
    (order.settlement?.manager?.remaining ?? 0) +
    (order.settlement?.measurer?.remaining ?? 0);
  const hasOpenMoney =
    clientRemaining > 0 || partnerRemaining > 0 || payrollRemaining > 0;
  const canComplete =
    !readOnly && ["DIRECTOR", "MANAGER"].includes(role) && !operationallyCompleted;
  const canFinancialClose =
    !readOnly && role === "DIRECTOR" && operationallyCompleted && !order.financialClosedAt;

  async function submit(
    payload: Record<string, unknown>,
    assets: File[] = [],
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}/completion`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Операция не выполнена");
      for (const file of assets) {
        const form = new FormData();
        form.set("file", file);
        const upload = await fetch(`/api/orders/${order.id}/completion/assets`, {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
          body: form,
        });
        const uploadBody = (await upload.json()) as { error?: string };
        if (!upload.ok)
          throw new Error(
            `Объект сдан, но файл «${file.name}» не загружен: ${uploadBody.error ?? "повторите загрузку"}`,
          );
      }
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Операция не выполнена");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="completion" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <PackageCheck size={20} className="text-emerald-300" /> Завершение объекта
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Сдача объекта и финансовое закрытие учитываются отдельно.
          </p>
        </div>
        {canComplete && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="min-h-11 rounded-xl bg-emerald-700 px-5 font-semibold text-white hover:bg-emerald-600"
          >
            Объект сдан
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className={`rounded-xl border p-4 ${operationallyCompleted ? "border-emerald-700/50 bg-emerald-950/20" : "border-slate-700 bg-slate-950/40"}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Операционно</p>
          <p className="mt-2 flex items-center gap-2 font-semibold text-white">
            <CheckCircle2 size={18} className={operationallyCompleted ? "text-emerald-300" : "text-slate-600"} />
            {operationallyCompleted ? "Объект сдан" : "Объект в работе"}
          </p>
        </div>
        <div className={`rounded-xl border p-4 ${order.financialClosedAt ? "border-blue-700/50 bg-blue-950/20" : "border-slate-700 bg-slate-950/40"}`}>
          <p className="text-xs uppercase tracking-wide text-slate-500">Финансово</p>
          <p className="mt-2 flex items-center gap-2 font-semibold text-white">
            <CircleDollarSign size={18} className={order.financialClosedAt ? "text-blue-300" : "text-slate-600"} />
            {order.financialClosedAt ? "Финансово закрыт" : "Расчёты открыты"}
          </p>
        </div>
      </div>
      {operationallyCompleted && !order.financialClosedAt && hasOpenMoney && (
        <p className="mt-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-100">
          Объект сдан, но расчёты продолжаются: клиент {money(clientRemaining)}, цех {money(partnerRemaining)}, сотрудники {money(payrollRemaining)}.
        </p>
      )}
      {canFinancialClose && (
        <button
          type="button"
          disabled={busy || hasOpenMoney}
          onClick={() => {
            const reason = window.prompt("Основание финансового закрытия")?.trim();
            if (reason) void submit({ action: "financial-close", reason });
          }}
          className="mt-3 min-h-11 rounded-xl border border-blue-600 px-4 font-semibold text-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Финансово закрыть заказ
        </button>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
      {open && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 bg-black/75"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busy) setOpen(false);
          }}
        >
          <form
            aria-label="Подтвердить сдачу объекта"
            onSubmit={(event) => {
              event.preventDefault();
              void submit({
                action: "deliver",
                completedAt: `${completedAt}T12:00:00+05:00`,
                comment,
                clientAccepted,
                contactConsent,
                photoVideoConsent,
              }, [photo, video].filter((file): file is File => Boolean(file)));
            }}
            className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-slate-700 bg-[#101827] p-5 sm:p-7"
          >
            <h3 className="text-xl font-semibold text-white">Объект сдан</h3>
            <p className="mt-2 text-sm text-slate-400">
              Финансовые остатки не блокируют сдачу. После сохранения маркетолог автоматически получит задачу на отзыв, фото и видео.
            </p>
            {hasOpenMoney && (
              <p className="mt-4 rounded-xl bg-amber-950/30 p-3 text-sm text-amber-100">
                Расчёты ещё открыты. Они сохранятся после завершения объекта.
              </p>
            )}
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm text-slate-300">
                Дата сдачи
                <input required type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} className={control} />
              </label>
              <label className="flex min-h-11 items-center gap-3 self-end rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white">
                <input type="checkbox" checked={clientAccepted} onChange={(event) => setClientAccepted(event.target.checked)} /> Клиент подтвердил приёмку
              </label>
              <label className="text-sm text-slate-300">
                Можно связаться для отзыва
                <select value={contactConsent} onChange={(event) => setContactConsent(event.target.value)} className={control}>
                  <option value="UNKNOWN">Не уточнено</option><option value="YES">Да</option><option value="NO">Нет</option>
                </select>
              </label>
              <label className="text-sm text-slate-300">
                Согласие на фото и видео
                <select value={photoVideoConsent} onChange={(event) => setPhotoVideoConsent(event.target.value)} className={control}>
                  <option value="UNKNOWN">Не уточнено</option><option value="YES">Да</option><option value="NO">Нет</option>
                </select>
              </label>
              <label className="text-sm text-slate-300 sm:col-span-2">
                Комментарий
                <textarea value={comment} onChange={(event) => setComment(event.target.value)} className={`${control} min-h-28 py-3`} />
              </label>
              <label className="text-sm text-slate-300">
                Фото объекта — необязательно
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} className={`${control} py-2 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3 file:py-2 file:text-white`} />
              </label>
              <label className="text-sm text-slate-300">
                Видео объекта — необязательно
                <input type="file" accept="video/mp4,video/webm" onChange={(event) => setVideo(event.target.files?.[0] ?? null)} className={`${control} py-2 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3 file:py-2 file:text-white`} />
              </label>
            </div>
            <div className="mt-6 grid grid-cols-2 gap-2">
              <button type="button" disabled={busy} onClick={() => setOpen(false)} className="min-h-11 rounded-xl border border-slate-700 font-semibold text-white">Отмена</button>
              <button disabled={busy || !completedAt} className="min-h-11 rounded-xl bg-emerald-700 font-semibold text-white disabled:opacity-50">{busy ? "Сохранение…" : "Подтвердить сдачу"}</button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
