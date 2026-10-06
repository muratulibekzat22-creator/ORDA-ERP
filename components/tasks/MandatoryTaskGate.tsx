"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, MessageCircle, Paperclip } from "lucide-react";

type Pending = {
  phase: "ACKNOWLEDGE" | "RESULT";
  task: {
    id: number;
    title: string;
    description: string | null;
    dueAt: string;
    workflow: "PAYMENT_COLLECTION" | "DAILY_CRM_REPORT" | "ORDER_DATA_COMPLETION" | "PLATFORM_ORIENTATION" | null;
    expectedAmount: string | number | null;
    plannedCompletionAt: string | null;
    creator: { name: string };
    client: { id: number; name: string; phone: string } | null;
    order: { id: number; number: string; client: { name: string; phone: string } } | null;
  };
};

const dateTime = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const defaultPlan = (now: number) => {
  const value = new Date(now + 86400_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

const paymentPlan = (now: number) => {
  const value = new Date(now + 60 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

const operationalPlan = (now: number) => {
  const value = new Date(now + 2 * 60 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

const isDailyOperation = (workflow: Pending["task"]["workflow"]) => workflow === "DAILY_CRM_REPORT" || workflow === "ORDER_DATA_COMPLETION" || workflow === "PLATFORM_ORIENTATION";

const localDateTime = (timestamp: number) => {
  const value = new Date(timestamp);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

const makePlanWindow = () => {
  const now = Date.now();
  return { min: localDateTime(now), max: localDateTime(now + 24 * 60 * 60_000), regular: defaultPlan(now), payment: paymentPlan(now), operational: operationalPlan(now) };
};

export default function MandatoryTaskGate({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [plannedAt, setPlannedAt] = useState("");
  const [planWindow, setPlanWindow] = useState(makePlanWindow);
  const [comment, setComment] = useState("");
  const [resultText, setResultText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [paymentOutcome, setPaymentOutcome] = useState("PAID");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Kaspi перевод");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/calendar/mandatory", { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { pending: Pending | null };
      setPending(body.pending);
      if (body.pending) {
        setPlanWindow(makePlanWindow());
        if (body.pending.task.workflow === "PAYMENT_COLLECTION" && body.pending.task.expectedAmount != null)
          setPaymentAmount((current) => current || String(body.pending!.task.expectedAmount));
      }
    }
    setLoaded(true);
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);
  const acknowledge = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending || !understood) return;
    setSaving(true); setError("");
    const selectedPlan = plannedAt || (pending.task.workflow === "PAYMENT_COLLECTION" ? planWindow.payment : isDailyOperation(pending.task.workflow) ? planWindow.operational : planWindow.regular);
    const response = await fetch("/api/calendar/mandatory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId: pending.task.id, plannedCompletionAt: new Date(selectedPlan).toISOString(), comment }) });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось подтвердить ознакомление");
    else { setUnderstood(false); setPlannedAt(""); setComment(""); await load(); }
    setSaving(false);
  };
  const submitResult = async (event: FormEvent) => {
    event.preventDefault();
    if (!pending) return;
    setSaving(true); setError("");
    const form = new FormData();
    form.set("resultText", resultText);
    if (pending.task.workflow === "PAYMENT_COLLECTION") {
      form.set("paymentOutcome", paymentOutcome);
      if (paymentOutcome === "PAID") {
        form.set("paymentAmount", paymentAmount);
        form.set("paymentMethod", paymentMethod);
      }
    }
    if (file) form.set("file", file);
    const response = await fetch(`/api/calendar/${pending.task.id}/result`, { method: "POST", body: form });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось отправить результат");
    else { setResultText(""); setFile(null); setPaymentOutcome("PAID"); setPaymentAmount(""); setPaymentMethod("Kaspi перевод"); await load(); }
    setSaving(false);
  };
  if (!loaded || !pending) return children;
  const task = pending.task;
  const paymentCollection = task.workflow === "PAYMENT_COLLECTION";
  const dailyOperation = isDailyOperation(task.workflow);
  const phone = task.order?.client.phone || task.client?.phone || "";
  const clientName = task.order?.client.name || task.client?.name || "клиент";
  const amount = task.expectedAmount == null ? null : Number(task.expectedAmount);
  const whatsappText = encodeURIComponent(`Здравствуйте, ${clientName}! Напоминаем о согласованной оплате${amount ? ` ${amount.toLocaleString("ru-RU")} ₸` : ""}${task.order ? ` по заказу №${task.order.number}` : ""}. Пожалуйста, сообщите после перевода.`);
  return <div className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-slate-950 p-4 text-white">
    <section className="w-full max-w-2xl rounded-3xl border border-amber-500/40 bg-[#101827] p-5 shadow-2xl sm:p-7">
      <div className="flex items-start gap-3"><div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-amber-500/15 text-amber-300"><CalendarClock/></div><div><p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">Обязательная задача от {task.creator.name}</p><h1 className="mt-1 text-2xl font-bold">{task.title}</h1></div></div>
      {task.description && <p className="mt-5 whitespace-pre-wrap rounded-2xl bg-slate-950 p-4 leading-7 text-slate-200">{task.description}</p>}
      <div className="mt-4 grid gap-2 text-sm text-slate-400 sm:grid-cols-2"><p>Срок руководителя: <b className="text-white">{dateTime(task.dueAt)}</b></p><p>{task.order ? `Заказ №${task.order.number} · ${task.order.client.name}` : task.client ? `Заявка · ${task.client.name}` : "Без привязки к клиенту"}</p></div>
      {paymentCollection && phone ? <a href={`https://wa.me/${phone.replace(/\D/g, "")}?text=${whatsappText}`} target="_blank" rel="noreferrer" className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold hover:bg-emerald-600"><MessageCircle size={18}/>Написать клиенту в WhatsApp</a> : null}
      {pending.phase === "ACKNOWLEDGE" ? <form onSubmit={acknowledge} className="mt-6 space-y-4">
        <label className="flex items-start gap-3 rounded-2xl border border-slate-700 bg-slate-950 p-4"><input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-1 size-5 accent-blue-600"/><span><b>Я ознакомился и понял задачу</b><span className="mt-1 block text-sm text-slate-400">После подтверждения рабочий кабинет откроется.</span></span></label>
        <label className="block text-sm text-slate-300">{paymentCollection ? "Когда свяжетесь с клиентом" : "Когда будет выполнено"}<input required type="datetime-local" min={planWindow.min} max={paymentCollection || dailyOperation ? planWindow.max : undefined} value={plannedAt || (paymentCollection ? planWindow.payment : dailyOperation ? planWindow.operational : planWindow.regular)} onChange={(event) => setPlannedAt(event.target.value)} className="control mt-1"/></label>
        <label className="block text-sm text-slate-300">Что понял / комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="control mt-1 resize-none" placeholder="Коротко подтвердите, что именно нужно сделать"/></label>
        <button disabled={!understood || saving} className="min-h-12 w-full rounded-xl bg-blue-600 font-semibold disabled:opacity-50">{saving ? "Сохраняем…" : "Подтвердить и перейти к работе"}</button>
      </form> : <form onSubmit={submitResult} className="mt-6 space-y-4">
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={19}/>Наступил указанный вами срок</p><p className="mt-1 text-sm text-blue-100/80">{paymentCollection ? "Зафиксируйте: клиент оплатил, перенёс срок или не ответил. Подтверждённая оплата автоматически попадёт в заказ и финансы." : "Напишите результат или прикрепите подтверждающий файл."}</p></div>
        {paymentCollection ? <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm text-slate-300 sm:col-span-2">Результат связи<select value={paymentOutcome} onChange={(event) => setPaymentOutcome(event.target.value)} className="control mt-1"><option value="PAID">Оплата получена</option><option value="PROMISED_LATER">Клиент перенёс срок</option><option value="NO_RESPONSE">Клиент не ответил</option><option value="REFUSED">Клиент отказался</option></select></label>
          {paymentOutcome === "PAID" ? <><label className="block text-sm text-slate-300">Точная полученная сумма<input required min="0.01" step="0.01" type="number" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="control mt-1"/></label><label className="block text-sm text-slate-300">Способ оплаты<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} className="control mt-1"><option>Kaspi перевод</option><option>Kaspi</option><option>Kaspi рассрочка</option><option>Наличные</option><option>Банковский перевод</option><option>Банковская карта</option><option>Карта</option><option>Другое</option></select></label></> : null}
          <p className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-sm text-emerald-100 sm:col-span-2">При выборе «Оплата получена» ORDA сразу зарегистрирует поступление в заказе, обновит остаток и создаст квитанцию. Повторно вносить платёж не нужно.</p>
        </div> : null}
        <label className="block text-sm text-slate-300">{paymentCollection ? "Комментарий / новый обещанный срок" : "Результат"}<textarea value={resultText} onChange={(event) => setResultText(event.target.value)} rows={5} className="control mt-1 resize-none" placeholder={paymentCollection ? "Что сообщил клиент; если срок перенесён — укажите новую дату" : "Что сделано, какой итог, что осталось"}/></label>
        {!paymentCollection || paymentOutcome !== "PAID" ? <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm"><Paperclip size={18}/><span className="min-w-0 flex-1 truncate">{file?.name ?? "Прикрепить фото, PDF, Word, Excel или видео до 25 МБ"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm,.docx,.xlsx" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} className="sr-only"/></label> : null}
        <button disabled={saving || (paymentCollection ? paymentOutcome === "PAID" ? !(Number(paymentAmount) > 0) : !resultText.trim() : !resultText.trim() && !file)} className="min-h-12 w-full rounded-xl bg-emerald-700 font-semibold disabled:opacity-50">{saving ? "Отправляем…" : paymentCollection && paymentOutcome === "PAID" ? "Подтвердить оплату и закрыть задачу" : "Отправить результат"}</button>
      </form>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    </section>
  </div>;
}
