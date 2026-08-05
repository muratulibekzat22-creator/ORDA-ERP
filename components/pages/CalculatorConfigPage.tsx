"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Save, ShieldCheck } from "lucide-react";
import { useSession } from "next-auth/react";

type Item = { code: string; uiName: string; kind: string; unit: string; salePrice: number; internalPrice: number; defaultQuantity: number; manualPriceAllowed: boolean; active: boolean; sortOrder: number };

export default function CalculatorConfigPage() {
  const { data: session } = useSession();
  const [items, setItems] = useState<Item[]>([]), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [message, setMessage] = useState("");
  const canEdit = session?.user.role === "DIRECTOR";
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/calculator-config", { cache: "no-store" });
      const payload = await response.json() as { items?: Item[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Конфигурация недоступна");
      setItems(payload.items ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Конфигурация недоступна"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const change = <K extends keyof Item>(index: number, key: K, value: Item[K]) => setItems((current) => current.map((item, position) => position === index ? { ...item, [key]: value } : item));
  const add = () => setItems((current) => [...current, { code: `NEW_ITEM_${Date.now()}`, uiName: "Новая позиция", kind: "OTHER_WORK", unit: "шт.", salePrice: 0, internalPrice: 0, defaultQuantity: 0, manualPriceAllowed: true, active: true, sortOrder: (current.at(-1)?.sortOrder ?? 0) + 10 }]);
  async function save() {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/calculator-config", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }) });
      const payload = await response.json() as { items?: Item[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить конфигурацию");
      setItems(payload.items ?? []); setMessage("Конфигурация калькулятора сохранена");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось сохранить конфигурацию"); }
    finally { setSaving(false); }
  }
  if (loading) return <section className="p-8 text-slate-300">Загрузка конфигурации…</section>;
  return <section className="flex-1 overflow-auto p-4 md:p-8">
    <h1 className="text-3xl font-bold text-white">Конфигурация калькулятора</h1>
    <p className="mt-2 text-slate-400">Продажные и внутренние тарифы ALTYN SAPA. Сохранённые расчёты остаются неизменными.</p>
    <div className="mt-5 flex gap-3 rounded-xl border border-amber-700/40 bg-amber-950/30 p-4 text-amber-200"><ShieldCheck className="shrink-0"/><p>{canEdit ? "Директор может изменять обе цены и состав позиций." : "Бухгалтеру доступен только просмотр при наличии права."}</p></div>
    {message && <p role="status" className="mt-4 rounded-xl bg-slate-900 p-4 text-slate-200">{message}</p>}
    <div className="mt-6 overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
      <table className="min-w-[1100px] w-full text-left text-sm">
        <thead className="bg-slate-900 text-slate-300"><tr>{["Название", "Единица", "Цена продажи", "Цена ЦЕХ", "По умолчанию", "Порядок", "Ручная цена", "Активна"].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead>
        <tbody>{items.map((item, index) => <tr key={item.code} className="border-t border-slate-800">
          <td className="p-2"><input aria-label={`Название ${index + 1}`} disabled={!canEdit} value={item.uiName} onChange={(e) => change(index, "uiName", e.target.value)} className="input min-w-48"/></td>
          <td className="p-2"><input aria-label={`Единица ${index + 1}`} disabled={!canEdit} value={item.unit} onChange={(e) => change(index, "unit", e.target.value)} className="input w-28"/></td>
          <td className="p-2"><input aria-label={`Цена продажи ${index + 1}`} type="number" min="0" disabled={!canEdit} value={item.salePrice} onChange={(e) => change(index, "salePrice", Number(e.target.value))} className="input w-36"/></td>
          <td className="p-2"><input aria-label={`Цена ЦЕХ ${index + 1}`} type="number" min="0" disabled={!canEdit} value={item.internalPrice} onChange={(e) => change(index, "internalPrice", Number(e.target.value))} className="input w-36"/></td>
          <td className="p-2"><input aria-label={`Количество по умолчанию ${index + 1}`} type="number" min="0" step="0.001" disabled={!canEdit} value={item.defaultQuantity} onChange={(e) => change(index, "defaultQuantity", Number(e.target.value))} className="input w-28"/></td>
          <td className="p-2"><input aria-label={`Порядок ${index + 1}`} type="number" disabled={!canEdit} value={item.sortOrder} onChange={(e) => change(index, "sortOrder", Number(e.target.value))} className="input w-24"/></td>
          <td className="p-2 text-center"><input aria-label={`Ручная цена ${index + 1}`} type="checkbox" disabled={!canEdit} checked={item.manualPriceAllowed} onChange={(e) => change(index, "manualPriceAllowed", e.target.checked)} className="size-5"/></td>
          <td className="p-2 text-center"><input aria-label={`Активна ${index + 1}`} type="checkbox" disabled={!canEdit} checked={item.active} onChange={(e) => change(index, "active", e.target.checked)} className="size-5"/></td>
        </tr>)}</tbody>
      </table>
    </div>
    {canEdit && <div className="mt-5 flex gap-3"><button type="button" onClick={add} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-700 px-4 text-white"><Plus size={18}/>Добавить позицию</button><button type="button" disabled={saving} onClick={() => void save()} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-60"><Save size={18}/>{saving ? "Сохраняем…" : "Сохранить"}</button></div>}
  </section>;
}
