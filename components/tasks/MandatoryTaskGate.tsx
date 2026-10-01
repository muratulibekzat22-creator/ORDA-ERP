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
    workflow: "PAYMENT_COLLECTION" | null;
    expectedAmount: string | number | null;
    plannedCompletionAt: string | null;
    creator: { name: string };
    client: { id: number; name: string; phone: string } | null;
    order: { id: number; number: string; client: { name: string; phone: string } } | null;
  };
};

const dateTime = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const defaultPlan = () => {
  const value = new Date(Date.now() + 86400_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

const paymentPlan = () => {
  const value = new Date(Date.now() + 60 * 60_000);
  value.setMinutes(value.getMinutes() - value.getTimezoneOffset());
  return value.toISOString().slice(0, 16);
};

export default function MandatoryTaskGate({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [plannedAt, setPlannedAt] = useState("");
  const [comment, setComment] = useState("");
  const [resultText, setResultText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/calendar/mandatory", { cache: "no-store" });
    if (response.ok) {
      const body = await response.json() as { pending: Pending | null };
      setPending(body.pending);
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
    const selectedPlan = plannedAt || (pending.task.workflow === "PAYMENT_COLLECTION" ? paymentPlan() : defaultPlan());
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
    const form = new FormData(); form.set("resultText", resultText); if (file) form.set("file", file);
    const response = await fetch(`/api/calendar/${pending.task.id}/result`, { method: "POST", body: form });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось отправить результат");
    else { setResultText(""); setFile(null); await load(); }
    setSaving(false);
  };
  if (!loaded || !pending) return children;
  const task = pending.task;
  const paymentCollection = task.workflow === "PAYMENT_COLLECTION";
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
        <label className="block text-sm text-slate-300">{paymentCollection ? "Когда свяжетесь с клиентом" : "Когда будет выполнено"}<input required type="datetime-local" min={new Date().toISOString().slice(0,16)} value={plannedAt || (paymentCollection ? paymentPlan() : defaultPlan())} onChange={(event) => setPlannedAt(event.target.value)} className="control mt-1"/></label>
        <label className="block text-sm text-slate-300">Что понял / комментарий<textarea value={comment} onChange={(event) => setComment(event.target.value)} rows={3} className="control mt-1 resize-none" placeholder="Коротко подтвердите, что именно нужно сделать"/></label>
        <button disabled={!understood || saving} className="min-h-12 w-full rounded-xl bg-blue-600 font-semibold disabled:opacity-50">{saving ? "Сохраняем…" : "Подтвердить и перейти к работе"}</button>
      </form> : <form onSubmit={submitResult} className="mt-6 space-y-4">
        <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 p-4"><p className="flex items-center gap-2 font-semibold"><CheckCircle2 size={19}/>Наступил указанный вами срок</p><p className="mt-1 text-sm text-blue-100/80">{paymentCollection ? "Зафиксируйте: клиент оплатил, перенёс срок или не ответил. Поступившие деньги отдельно внесите в заказ." : "Напишите результат или прикрепите подтверждающий файл."}</p></div>
        <label className="block text-sm text-slate-300">Результат<textarea value={resultText} onChange={(event) => setResultText(event.target.value)} rows={5} className="control mt-1 resize-none" placeholder="Что сделано, какой итог, что осталось"/></label>
        <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 text-sm"><Paperclip size={18}/><span className="min-w-0 flex-1 truncate">{file?.name ?? "Прикрепить фото, PDF, Word, Excel или видео до 25 МБ"}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm,.docx,.xlsx" onChange={(event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)} className="sr-only"/></label>
        <button disabled={saving || (!resultText.trim() && !file)} className="min-h-12 w-full rounded-xl bg-emerald-700 font-semibold disabled:opacity-50">{saving ? "Отправляем…" : "Отправить результат"}</button>
      </form>}
      {error && <p role="alert" className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p>}
    </section>
  </div>;
}
