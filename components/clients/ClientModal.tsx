"use client";

import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";

export type ClientDraft = { name: string; phone: string; whatsapp: string; city: string; address: string; source: string; manager: string; status: string; estimateNotes: string; estimatedAmount: string };
type Props = { open: boolean; onClose: () => void; onSave: (client: ClientDraft) => Promise<void>; saving?: boolean };

const initial: ClientDraft = { name: "", phone: "+7", whatsapp: "+7", city: "Алматы", address: "", source: "Instagram", manager: "", status: "Новый", estimateNotes: "", estimatedAmount: "0" };

export default function ClientModal({ open, onClose, onSave, saving = false }: Props) {
  const [form, setForm] = useState(initial);
  const [fieldError, setFieldError] = useState("");
  useEffect(() => { if (!open) return; const close = (event: KeyboardEvent) => event.key === "Escape" && !saving && onClose(); document.addEventListener("keydown", close); return () => document.removeEventListener("keydown", close); }, [onClose, open, saving]);
  if (!open) return null;
  const update = (key: keyof ClientDraft, value: string) => setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) { event.preventDefault(); setFieldError(""); if (form.name.trim().length < 2) return setFieldError("Укажите ФИО клиента"); if (form.phone.replace(/\D/g, "").length < 11) return setFieldError("Укажите корректный телефон"); if (!form.manager.trim()) return setFieldError("Укажите менеджера"); try { await onSave(form); setForm(initial); } catch { /* Parent keeps the form open and displays the API error. */ } }
  const inputClass = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="new-client-title"><form onSubmit={submit} className="max-h-[95vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 shadow-2xl sm:max-w-3xl sm:rounded-2xl sm:p-7"><div className="flex items-center justify-between gap-4"><div><h2 id="new-client-title" className="text-2xl font-bold text-white">Новый клиент</h2><p className="mt-1 text-sm text-slate-400">Контакты и первичная информация по заявке</p></div><button type="button" onClick={onClose} disabled={saving} aria-label="Закрыть" className="grid min-h-11 min-w-11 place-items-center rounded-xl text-slate-300 hover:bg-slate-800"><X /></button></div>{fieldError && <p className="mt-4 rounded-xl bg-red-950/50 p-3 text-sm text-red-300" role="alert">{fieldError}</p>}<div className="mt-6 grid gap-4 sm:grid-cols-2">
  <Field label="ФИО" required><input id="client-name" autoFocus value={form.name} onChange={(e)=>update("name",e.target.value)} className={inputClass} placeholder="Например, Айдос Сарсенов" /></Field>
  <Field label="Телефон" required><input id="client-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e)=>update("phone",e.target.value)} className={inputClass} placeholder="+7 777 000 00 00" /></Field>
  <Field label="WhatsApp"><input id="client-whatsapp" type="tel" inputMode="tel" value={form.whatsapp} onChange={(e)=>update("whatsapp",e.target.value)} className={inputClass} placeholder="+7 777 000 00 00" /></Field>
  <Field label="Город" required><input id="client-city" value={form.city} onChange={(e)=>update("city",e.target.value)} className={inputClass} /></Field>
  <Field label="Адрес"><input id="client-address" value={form.address} onChange={(e)=>update("address",e.target.value)} className={inputClass} placeholder="Район, улица, дом" /></Field>
  <Field label="Источник заявки"><select id="client-source" value={form.source} onChange={(e)=>update("source",e.target.value)} className={inputClass}>{["Instagram","WhatsApp","Рекомендация","Сайт","Повторный клиент","Другое"].map(x=><option key={x}>{x}</option>)}</select></Field>
  <Field label="Менеджер" required><input id="client-manager" value={form.manager} onChange={(e)=>update("manager",e.target.value)} className={inputClass} placeholder="ФИО менеджера" /></Field>
  <Field label="Статус"><select id="client-status" value={form.status} onChange={(e)=>update("status",e.target.value)} className={inputClass}>{["Новый","В работе","Ждёт КП","Замер назначен","Не отвечает","Сделка","Завершено"].map(x=><option key={x}>{x}</option>)}</select></Field>
  <Field label="Предварительная сумма"><input id="client-estimated" type="number" inputMode="decimal" min="0" value={form.estimatedAmount} onChange={(e)=>update("estimatedAmount",e.target.value)} className={inputClass} /></Field>
  <div className="sm:col-span-2"><Field label="Предварительный расчёт"><textarea id="client-estimate" rows={7} value={form.estimateNotes} onChange={(e)=>update("estimateNotes",e.target.value)} className={inputClass} placeholder={"Дуб ламель — 2 350 000\nКарагач — 2 150 000\nЛатунь, подсветка, стекло\nКомментарии..."} /></Field></div>
  </div><div className="sticky bottom-0 -mx-5 mt-6 flex gap-3 border-t border-slate-700 bg-[#101827] px-5 pt-4 sm:-mx-7 sm:px-7"><button type="button" onClick={onClose} disabled={saving} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-5 text-white">Отмена</button><button disabled={saving} className="min-h-11 flex-1 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-60">{saving ? "Сохраняем…" : "Создать клиента"}</button></div></form></div>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) { return <label className="block text-sm text-slate-300"><span className="mb-2 block">{label}{required && <span className="text-red-400"> *</span>}</span>{children}</label>; }
