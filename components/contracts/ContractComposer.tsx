"use client";

import { FileCheck2, X } from "lucide-react";
import { useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Payment = { mode: "PERCENT"; prepaymentPercent: number } | { mode: "AMOUNT"; prepaymentAmount: number };
type Form = { clientFullName: string; clientIin: string; clientPhone: string; clientAddress: string; installationAddress: string; stairMaterial: string; balusterType: string; contractAmount: number; payment: Payment; prepaymentDueText: string; balanceDueText: string; fullPaymentDueText: string; termCalendarDays: number; termStartCondition: string; warrantyMonths: number | null; productionContactName: string; productionContactPhone: string };
type Preview = Record<string, string | number | boolean>;
export type GeneratedContract = { id: number; number: string; currentVersion: number; versions?: Array<{ id: number; version: number }> };
const control = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-blue-500";

export default function ContractComposer({ orderId, onGenerated, autoOpen = false, showTrigger = true, onClosed }: { orderId: number; onGenerated: (document?: GeneratedContract) => void; autoOpen?: boolean; showTrigger?: boolean; onClosed?: () => void }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(false), [error, setError] = useState(""), [form, setForm] = useState<Form | null>(null), [preview, setPreview] = useState<Preview | null>(null);

  const begin = useCallback(async () => {
    setOpen(true); setLoading(true); setError(""); setPreview(null);
    try { const response = await fetch(`/api/orders/${orderId}/contract`, { cache: "no-store" }); const body = await response.json(); if (!response.ok) throw new Error(body.error); setForm(body); }
    catch (next) { setError(next instanceof Error ? next.message : "Не удалось загрузить данные"); }
    finally { setLoading(false); }
  }, [orderId]);

  useEffect(() => { if (!autoOpen) return; const timer = window.setTimeout(() => void begin(), 0); return () => window.clearTimeout(timer); }, [autoOpen, begin]);

  if (!["DIRECTOR", "MANAGER"].includes(session?.user.role ?? "")) return null;

  function close() { setOpen(false); setPreview(null); onClosed?.(); }

  async function send(action: "preview" | "generate") {
    if (!form) return; setLoading(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/contract`, { method: "POST", headers: { "Content-Type": "application/json", ...(action === "generate" ? { "Idempotency-Key": crypto.randomUUID() } : {}) }, body: JSON.stringify({ action, input: form }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.error ?? "Ошибка формирования договора");
      if (action === "preview") setPreview(body); else { close(); onGenerated(body); }
    } catch (next) { setError(next instanceof Error ? next.message : "Ошибка формирования договора"); }
    finally { setLoading(false); }
  }

  function submit(event: FormEvent) { event.preventDefault(); void send("preview"); }
  function set<K extends keyof Form>(key: K, value: Form[K]) { setForm((current) => current ? { ...current, [key]: value } : current); setPreview(null); }

  return <>
    {showTrigger && <button onClick={() => void begin()} className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-4 font-semibold text-white"><FileCheck2 size={18}/>Сформировать комплект документов</button>}
    {open && <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 sm:items-center sm:p-4"><form onSubmit={submit} className="max-h-dvh w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:rounded-2xl">
      <div className="mb-5 flex items-center justify-between"><div><h2 className="text-xl font-bold text-white">Оформление договорного комплекта</h2><p className="text-sm text-slate-400">Данные заказа заполнены автоматически. Будут созданы договор на 2 страницах и отдельная памятка.</p></div><button type="button" aria-label="Закрыть" onClick={close} className="grid size-11 place-items-center text-slate-300"><X/></button></div>
      {error && <p className="mb-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-300">{error}</p>}
      {loading && !form ? <p className="p-8 text-slate-400">Загрузка…</p> : form && !preview ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Field label="ФИО клиента *"><input required value={form.clientFullName} onChange={(e) => set("clientFullName", e.target.value)} className={control}/></Field>
        <Field label="ИИН *"><input required inputMode="numeric" pattern="\d{12}" maxLength={12} value={form.clientIin} onChange={(e) => set("clientIin", e.target.value.replace(/\D/g, ""))} className={control}/></Field>
        <Field label="Телефон"><input value={form.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} className={control}/></Field>
        <Field label="Адрес клиента"><input value={form.clientAddress} onChange={(e) => set("clientAddress", e.target.value)} className={control}/></Field>
        <Field label="Адрес объекта"><input required value={form.installationAddress} onChange={(e) => set("installationAddress", e.target.value)} className={control}/></Field>
        <Field label="Материал лестницы"><input required list="contract-materials" value={form.stairMaterial} onChange={(e) => set("stairMaterial", e.target.value)} className={control}/><datalist id="contract-materials"><option value="Сосна"/><option value="Карагач"/><option value="МДФ шпон"/><option value="Дуб ламель"/></datalist></Field>
        <Field label="Балясина / ограждение"><input required list="contract-balusters" value={form.balusterType} onChange={(e) => set("balusterType", e.target.value)} className={control}/><datalist id="contract-balusters"><option value="Классика"/><option value="Барокко"/><option value="Латунь"/><option value="Стекло"/><option value="Без балясин"/></datalist></Field>
        <Field label="Общая стоимость, ₸"><input required type="number" min={1} step={1} value={form.contractAmount} onChange={(e) => set("contractAmount", Number(e.target.value))} className={control}/></Field>
        <Field label="Первый платёж"><div className="flex gap-2"><select value={form.payment.mode} onChange={(e) => set("payment", e.target.value === "PERCENT" ? { mode: "PERCENT", prepaymentPercent: 70 } : { mode: "AMOUNT", prepaymentAmount: 0 })} className={control}><option value="PERCENT">Процент</option><option value="AMOUNT">Сумма</option></select><input required type="number" min={1} max={form.payment.mode === "PERCENT" ? 100 : form.contractAmount} step={form.payment.mode === "PERCENT" ? "0.01" : "1"} value={form.payment.mode === "PERCENT" ? form.payment.prepaymentPercent : form.payment.prepaymentAmount} onChange={(e) => set("payment", form.payment.mode === "PERCENT" ? { mode: "PERCENT", prepaymentPercent: Number(e.target.value) } : { mode: "AMOUNT", prepaymentAmount: Number(e.target.value) })} className={control}/></div></Field>
        <Field label="Условие остатка"><select value={form.balanceDueText} onChange={(e) => set("balanceDueText", e.target.value)} className={control}>{["после завершения монтажа", "в день приёмки", "до монтажа", "по индивидуальному утверждённому графику"].map((v) => <option key={v}>{v}</option>)}</select></Field>
        <Field label="Срок, календарных дней"><input required type="number" min={1} max={730} value={form.termCalendarDays} onChange={(e) => set("termCalendarDays", Number(e.target.value))} className={control}/></Field>
        <Field label="Начало срока"><select value={form.termStartCondition} onChange={(e) => set("termStartCondition", e.target.value)} className={control}><option>с даты внесения первого платежа</option><option>с даты подписания Договора</option></select></Field>
        <Field label="Гарантия, месяцев *"><input required type="number" min={1} max={120} value={form.warrantyMonths ?? ""} onChange={(e) => set("warrantyMonths", e.target.value ? Number(e.target.value) : null)} className={control}/></Field>
        <Field label="Контакт производства"><input value={form.productionContactName} onChange={(e) => set("productionContactName", e.target.value)} className={control}/></Field>
        <Field label="Телефон производства"><input value={form.productionContactPhone} onChange={(e) => set("productionContactPhone", e.target.value)} className={control}/></Field>
      </div> : preview && <PreviewCard value={preview}/>}
      {form && <div className="mt-6 flex flex-wrap justify-end gap-3">{preview && <button type="button" onClick={() => setPreview(null)} className="min-h-11 rounded-xl border border-slate-600 px-4 text-white">Изменить</button>}<button disabled={loading} type={preview ? "button" : "submit"} onClick={preview ? () => void send("generate") : undefined} className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50">{loading ? "Формирование…" : preview ? "Сформировать комплект" : "Предпросмотр договора"}</button></div>}
    </form></div>}
  </>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm text-slate-300"><span className="mb-1 block">{label}</span>{children}</label>; }
function PreviewCard({ value }: { value: Preview }) { const rows = [["№", value.contractNumber], ["Дата / время", `${value.contractDay} ${value.contractMonth} ${value.contractYear}, ${value.contractTime}`], ["Клиент", value.clientFullName], ["ИИН", value.clientIin], ["Телефон", value.clientPhone], ["Адрес клиента", value.clientAddress], ["Адрес монтажа", value.installationAddress], ["Материал", value.stairMaterial], ["Ограждение", value.balusterType], ["Стоимость", `${value.contractAmount} ₸ (${value.contractAmountWords})`], ["Первый платёж", `${value.prepaymentAmount} ₸ / ${value.prepaymentPercent}%`], ["Остаток", value.isFullPayment ? "100% оплата" : `${value.balanceAmount} ₸ / ${value.balancePercent}%`], ["Срок", `${value.termCalendarDays} календарных дней`], ["Гарантия", value.warrantyText]]; return <div className="rounded-2xl border border-slate-700 bg-slate-950/60 p-5"><h3 className="mb-4 text-lg font-bold text-white">Предпросмотр договора</h3><dl className="grid gap-3 sm:grid-cols-2">{rows.map(([label, content]) => <div key={String(label)}><dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-1 break-words text-white">{String(content ?? "—")}</dd></div>)}</dl></div>; }
