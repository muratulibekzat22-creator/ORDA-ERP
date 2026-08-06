"use client";
import { useMemo, useState } from "react";

type Calculation = { id: number; baseClientPrice: string; clientPrice: string };
export default function PriceObjectionPanel({ clientId, calculations, proposalId, onDone }: { clientId: number; calculations: Calculation[]; proposalId?: number; onDone: (message: string) => void }) {
  const current = calculations[0];
  const [open, setOpen] = useState(false), [price, setPrice] = useState(""), [reason, setReason] = useState("Клиент сказал: дорого"), [comment, setComment] = useState(""), [channel, setChannel] = useState("WhatsApp"), [nextActionAt, setNextActionAt] = useState("");
  const discount = useMemo(() => current && price ? Number(current.baseClientPrice) - Number(price) : 0, [current, price]);
  if (!current) return null;
  async function saveFollowUp() {
    const response = await fetch(`/api/clients/${clientId}/follow-ups`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: current.id, proposalId, oldPrice: Number(current.clientPrice), proposedPrice: Number(price), standardPrice: Number(current.baseClientPrice), reason, comment, channel, nextActionAt }) });
    const body = await response.json(); onDone(response.ok ? "Повторный контакт поставлен" : body.error ?? "Не удалось поставить напоминание"); if (response.ok) setOpen(false);
  }
  async function requestApproval() {
    const response = await fetch("/api/price-approvals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ calculationId: current.id, proposalId, requestedSalePrice: Number(price), reason, comment }) });
    const body = await response.json(); onDone(response.ok ? "Запрос специальной цены отправлен директору" : body.error ?? "Не удалось отправить запрос");
  }
  return <section className="rounded-2xl border border-amber-700/50 bg-amber-950/20 p-5">
    <button type="button" onClick={() => setOpen((value) => !value)} className="min-h-11 rounded-xl bg-amber-600 px-5 font-semibold text-black">Клиент сказал: дорого</button>
    {open && <div className="mt-5 grid gap-4 md:grid-cols-2">
      <div className="rounded-xl bg-slate-900 p-4 text-slate-200"><p>Текущая стоимость: <b>{Number(current.clientPrice).toLocaleString("ru-RU")} ₸</b></p><p>Стандартная стоимость: <b>{Number(current.baseClientPrice).toLocaleString("ru-RU")} ₸</b></p><p>Скидка: <b>{discount.toLocaleString("ru-RU")} ₸</b></p></div>
      <label className="text-sm text-slate-300">Новая предлагаемая стоимость<input type="number" min="1" value={price} onChange={(e) => setPrice(e.target.value)} className="input mt-1"/></label>
      <label className="text-sm text-slate-300">Причина<input value={reason} onChange={(e) => setReason(e.target.value)} className="input mt-1"/></label>
      <label className="text-sm text-slate-300">Комментарий<input value={comment} onChange={(e) => setComment(e.target.value)} className="input mt-1"/></label>
      <label className="text-sm text-slate-300">Повторный контакт<input type="datetime-local" value={nextActionAt} onChange={(e) => setNextActionAt(e.target.value)} className="input mt-1"/></label>
      <label className="text-sm text-slate-300">Канал<select value={channel} onChange={(e) => setChannel(e.target.value)} className="input mt-1"><option>WhatsApp</option><option>Звонок</option></select></label>
      <div className="flex flex-wrap gap-3 md:col-span-2"><button disabled={!price || !nextActionAt} onClick={() => void saveFollowUp()} className="rounded-xl bg-blue-600 px-5 py-3 text-white disabled:opacity-50">Сохранить и поставить напоминание</button><button disabled={!price} onClick={() => void requestApproval()} className="rounded-xl bg-rose-700 px-5 py-3 text-white disabled:opacity-50">Запросить специальную цену</button></div>
    </div>}
  </section>;
}
