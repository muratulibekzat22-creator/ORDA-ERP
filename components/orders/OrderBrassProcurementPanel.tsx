"use client";

import { ExternalLink, PackageCheck } from "lucide-react";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  BRASS_COST_BEARER_LABELS,
  BRASS_MODEL_OPTIONS,
  EMPTY_BRASS_MODEL_QUANTITIES,
  normalizeBrassModelQuantities,
  totalBrassPairs,
  type BrassCostBearer,
  type BrassModelQuantities,
} from "@/lib/brass/catalog";

type Procurement = {
  id: number;
  quantityPairs: number;
  modelQuantities: BrassModelQuantities;
  costBearer: BrassCostBearer;
  status: string;
  expectedArrivalDate: string | null;
  receivedAt: string | null;
  goodsCostKzt: number;
  cargoCostKzt: number;
  landedCostKzt: number;
  supplierPaidKzt: number;
  supplierBalanceKzt: number;
  cargoPaidKzt: number;
  cargoBalanceKzt: number;
  notes: string;
  photoUrl: string | null;
  photoAttachment: { fileName: string } | null;
  supplier: { name: string } | null;
  responsibleUser: { name: string };
  purchaseBatch: { number: string; status: string } | null;
  reminderTask: { dueAt: string; status: string } | null;
};

const statusLabel: Record<string, string> = {
  REQUESTED: "Нужно заказать",
  ORDERED: "Заказано у поставщика",
  IN_TRANSIT: "В пути",
  RECEIVED: "Получено",
  COST_FINALIZED: "Получено · себестоимость рассчитана",
  CANCELLED: "Отменено",
};
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const control = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";

export default function OrderBrassProcurementPanel({
  orderId,
  readOnly,
  canSeeCost,
  defaultCostBearer = "COMPANY",
}: {
  orderId: number;
  readOnly: boolean;
  canSeeCost: boolean;
  defaultCostBearer?: BrassCostBearer;
}) {
  const [row, setRow] = useState<Procurement | null | undefined>(undefined);
  const [modelQuantities, setModelQuantities] = useState<BrassModelQuantities>({
    ...EMPTY_BRASS_MODEL_QUANTITIES,
  });
  const [costBearer, setCostBearer] = useState<BrassCostBearer>(defaultCostBearer);
  const [notes, setNotes] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const submitting = useRef(false);
  const submissionKey = useRef<string | null>(null);
  const totalPairs = totalBrassPairs(modelQuantities);

  useEffect(() => {
    void fetch(`/api/orders/${orderId}/brass-procurement`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as Procurement & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить заявку");
        setRow(body);
      })
      .catch((cause: unknown) => {
        setMessage(cause instanceof Error ? cause.message : "Не удалось загрузить заявку");
        setRow(null);
      });
  }, [orderId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (totalPairs <= 0 || totalPairs > 10_000)
      return setMessage("Укажите количество хотя бы одной модели");
    submitting.current = true;
    setSaving(true);
    setMessage("");
    try {
      submissionKey.current ??= crypto.randomUUID();
      const form = new FormData();
      for (const model of BRASS_MODEL_OPTIONS)
        form.set(`model_${model.key}`, String(modelQuantities[model.key]));
      form.set("costBearer", costBearer);
      form.set("notes", notes);
      if (photo) form.set("photo", photo);
      const response = await fetch(`/api/orders/${orderId}/brass-procurement`, {
        method: "POST",
        headers: { "Idempotency-Key": submissionKey.current },
        body: form,
      });
      const body = (await response.json()) as Procurement & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось создать заявку");
      submissionKey.current = null;
      setRow(body);
      setMessage("Заявка передана на склад");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не удалось создать заявку");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  if (row === undefined)
    return <p className="rounded-2xl border border-slate-800 bg-[#101827] p-5 text-slate-400">Проверяем заявку на латунь…</p>;

  return (
    <section className="rounded-2xl border border-amber-500/25 bg-[#101827] shadow-sm">
      <div className="flex items-start gap-3 border-b border-slate-800 p-4 md:p-5">
        <span className="rounded-xl bg-amber-500/10 p-2 text-amber-200"><PackageCheck size={20} /></span>
        <div><h2 className="font-semibold text-white">Латунные балясины</h2><p className="mt-1 text-sm text-slate-400">От заявки менеджера до приёмки, карго и полной себестоимости.</p></div>
      </div>
      {row ? <div className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><span className="rounded-full bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-100">{statusLabel[row.status] ?? row.status}</span><p className="mt-3 text-2xl font-bold text-white">{row.quantityPairs.toLocaleString("ru-RU")} пар</p></div>
          {row.photoUrl ? <a href={row.photoUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-blue-200"><ExternalLink size={16} /> Открыть фото</a> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-3">{BRASS_MODEL_OPTIONS.map((model) => <Info key={model.key} label={model.label} value={`${normalizeBrassModelQuantities(row.modelQuantities)[model.key]} пар`} />)}</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Поставщик" value={row.supplier?.name ?? "Склад ещё не оформил заказ"} />
          <Info label="Ответственный" value={row.responsibleUser.name} />
          <Info label="Расходы несёт" value={BRASS_COST_BEARER_LABELS[row.costBearer]} />
          <Info label="Ожидаемая доставка" value={row.expectedArrivalDate ? new Date(row.expectedArrivalDate).toLocaleDateString("ru-RU") : "Не назначена"} />
          <Info label="Закупочная партия" value={row.purchaseBatch?.number ?? "Не создана"} />
        </div>
        {canSeeCost && row.goodsCostKzt > 0 ? <div className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/55 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Info label="Товар" value={money(row.goodsCostKzt)} />
          <Info label="Оплачено поставщику" value={money(row.supplierPaidKzt)} />
          <Info label="Осталось поставщику" value={money(row.supplierBalanceKzt)} />
          <Info label="Карго" value={money(row.cargoCostKzt)} />
          <Info label="Оплачено карго" value={money(row.cargoPaidKzt)} />
          <Info label="Осталось за карго" value={money(row.cargoBalanceKzt)} />
          <Info label="Полная себестоимость" value={money(row.landedCostKzt)} strong />
        </div> : null}
        {row.reminderTask ? <p className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-3 text-sm text-blue-100">Контроль поставщика назначен на {new Date(row.reminderTask.dueAt).toLocaleString("ru-RU")}. Задача появится у ответственного в календаре.</p> : null}
        {row.notes ? <p className="text-sm text-slate-300"><span className="text-slate-500">Комментарий:</span> {row.notes}</p> : null}
      </div> : readOnly ? <p className="p-5 text-slate-400">Заявка на латунь не создавалась.</p> : <form onSubmit={submit} className="grid gap-4 p-4 sm:grid-cols-2 md:p-5">
        {BRASS_MODEL_OPTIONS.map((model) => <label key={model.key} className="text-sm text-slate-300">{model.label}, пар<input type="number" min="0" max="10000" step="1" value={modelQuantities[model.key] || ""} onChange={(event) => setModelQuantities((current) => ({ ...current, [model.key]: Number(event.target.value || 0) }))} className={`${control} mt-1`} /></label>)}
        <div className="rounded-xl border border-amber-500/20 bg-slate-950/60 p-3"><p className="text-xs uppercase tracking-wide text-slate-500">Общее количество</p><p className="mt-1 text-xl font-bold text-amber-100">{totalPairs.toLocaleString("ru-RU")} пар</p></div>
        <label className="text-sm text-slate-300">Кто несёт расходы<select value={costBearer} onChange={(event) => setCostBearer(event.target.value as BrassCostBearer)} className={`${control} mt-1`}>{Object.entries(BRASS_COST_BEARER_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="text-sm text-slate-300">Фото модели / образца <span className="text-slate-500">(необязательно)</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} className={`${control} mt-1 py-2`} /></label>
        <label className="text-sm text-slate-300 sm:col-span-2">Комментарий складу<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className={`${control} mt-1 py-3`} placeholder="Модель, цвет и особенности комплекта" /></label>
        <button disabled={saving} className="min-h-12 rounded-xl bg-amber-600 px-5 font-semibold text-white disabled:opacity-50 sm:w-fit">{saving ? "Передаём на склад…" : "Создать заявку на латунь"}</button>
      </form>}
      {message ? <p role="status" className="border-t border-slate-800 p-4 text-sm text-blue-200 md:px-5">{message}</p> : null}
    </section>
  );
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="rounded-xl bg-slate-950/55 p-3"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-sm ${strong ? "font-bold text-emerald-200" : "font-medium text-white"}`}>{value}</p></div>;
}
