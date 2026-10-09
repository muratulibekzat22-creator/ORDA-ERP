"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Line = { id: number; orderedQuantity: string; receivedQuantity: string; material: { name: string; unit: string } };
type Location = { id: number; name: string; isDefault: boolean };

export default function PurchaseReceiptForm({ batchId, lines, disabled, onSaved }: { batchId: number; lines: Line[]; disabled: boolean; onSaved: () => Promise<void> }) {
  const remaining = useMemo(() => lines.filter((line) => Number(line.orderedQuantity) > Number(line.receivedQuantity)), [lines]);
  const [locations, setLocations] = useState<Location[]>([]), [locationId, setLocationId] = useState("");
  const [quantities, setQuantities] = useState<Record<number, { received: string; rejected: string }>>(() =>
    Object.fromEntries(remaining.map((line) => [line.id, { received: String(Number(line.orderedQuantity) - Number(line.receivedQuantity)), rejected: "0" }])),
  );
  const [documentNumber, setDocumentNumber] = useState(""), [documentDate, setDocumentDate] = useState(""), [note, setNote] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  useEffect(() => {
    void fetch("/api/warehouse/locations", { cache: "no-store" }).then((response) => response.json()).then((value: { locations?: Location[] }) => {
      const rows = value.locations ?? [];
      setLocations(rows);
      setLocationId(String(rows.find((item) => item.isDefault)?.id ?? rows[0]?.id ?? ""));
    }).catch(() => setError("Не удалось загрузить места хранения"));
  }, []);
  if (!remaining.length) return null;
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const receiptLines = remaining.map((line) => ({ lineId: line.id, receivedQuantity: Number(quantities[line.id]?.received ?? 0), rejectedQuantity: Number(quantities[line.id]?.rejected ?? 0) })).filter((line) => line.receivedQuantity > 0);
      if (!receiptLines.length) throw new Error("Укажите фактически прибывшее количество");
      const response = await fetch(`/api/purchase-batches/${batchId}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ action: "receive", locationId: Number(locationId), supplierDocumentNumber: documentNumber || undefined, supplierDocumentDate: documentDate || undefined, note: note || undefined, lines: receiptLines }) });
      const value = await response.json() as { error?: string };
      if (!response.ok) throw new Error(value.error || "Поступление не проведено");
      setKey(crypto.randomUUID());
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Поступление не проведено"); } finally { setSaving(false); }
  }
  return <details className="mt-5 rounded-xl border border-emerald-700/40 bg-emerald-950/10 p-4" open>
    <summary className="cursor-pointer font-semibold text-emerald-200">Поступление на склад</summary>
    <form onSubmit={submit} className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3"><label className="text-xs text-slate-400">Место хранения<select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white"><option value="">Выберите склад</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-xs text-slate-400">Номер документа поставщика<input value={documentNumber} onChange={(event) => setDocumentNumber(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white" /></label><label className="text-xs text-slate-400">Дата документа поставщика<input type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white" /></label></div>
      <div className="space-y-2">{remaining.map((line) => <div key={line.id} className="grid gap-2 rounded-lg bg-slate-950/60 p-3 sm:grid-cols-[1fr_9rem_9rem]"><p className="text-sm font-medium text-white">{line.material.name}<span className="block text-xs font-normal text-slate-500">Осталось принять: {Number(line.orderedQuantity) - Number(line.receivedQuantity)} {line.material.unit}</span></p><label className="text-xs text-slate-400">Прибыло<input required type="number" min="0" max={Number(line.orderedQuantity) - Number(line.receivedQuantity)} step="0.001" value={quantities[line.id]?.received ?? ""} onChange={(event) => setQuantities({ ...quantities, [line.id]: { ...quantities[line.id], received: event.target.value } })} className="mt-1 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" /></label><label className="text-xs text-slate-400">Брак / отклонено<input type="number" min="0" step="0.001" value={quantities[line.id]?.rejected ?? "0"} onChange={(event) => setQuantities({ ...quantities, [line.id]: { ...quantities[line.id], rejected: event.target.value } })} className="mt-1 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" /></label></div>)}</div>
      <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Комментарий к приёмке" className="min-h-20 w-full rounded-xl bg-slate-900 p-3 text-white" />
      {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      <button disabled={disabled || saving || !locationId} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">{saving ? "Проведение…" : "Провести поступление"}</button>
    </form>
  </details>;
}
