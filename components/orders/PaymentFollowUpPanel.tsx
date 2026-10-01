"use client";

import { CalendarClock, CheckCircle2, MessageCircle, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Item = {
  id: number;
  dueAt: string;
  status: "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  expectedAmount: string | number | null;
  acknowledgedAt: string | null;
  resultText: string | null;
  resultSubmittedAt: string | null;
  overdue: boolean;
  assignee: { name: string };
  order: { number: string; client: { name: string; phone: string } } | null;
};

const control = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";
const money = (value: string | number | null) => value == null ? "—" : `${Number(value).toLocaleString("ru-RU")} ₸`;
const date = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Asia/Almaty", dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export default function PaymentFollowUpPanel({ orderId, balance, clientName, clientPhone, readOnly = false }: { orderId: number; balance: number; clientName: string; clientPhone: string; readOnly?: boolean }) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: "", dueAt: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/payment-follow-ups`, { cache: "no-store" });
      const body = await response.json() as { items?: Item[]; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить обещанные доплаты");
      setItems(body.items ?? []);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось загрузить обещанные доплаты"); }
    finally { setLoading(false); }
  }, [orderId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function create() {
    const amount = Number(form.amount);
    const dueAt = new Date(form.dueAt);
    if (!Number.isFinite(amount) || amount <= 0 || amount > balance) return setError("Сумма должна быть больше нуля и не превышать остаток клиента");
    if (Number.isNaN(dueAt.getTime())) return setError("Укажите дату и время обещанной доплаты");
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/payment-follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ amount, dueAt: dueAt.toISOString() }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось поставить напоминание");
      setForm({ amount: "", dueAt: "" }); setOpen(false); await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось поставить напоминание"); }
    finally { setSaving(false); }
  }

  async function cancel(taskId: number) {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/payment-follow-ups/${taskId}`, { method: "DELETE" });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось отменить напоминание");
      await load(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отменить напоминание"); }
    finally { setSaving(false); }
  }

  const active = items.filter((item) => !["COMPLETED", "CANCELLED"].includes(item.status));
  const whatsapp = `https://wa.me/${clientPhone.replace(/\D/g, "")}?text=${encodeURIComponent(`Здравствуйте, ${clientName}! Напоминаем о согласованной оплате по вашему заказу. Пожалуйста, сообщите после перевода.`)}`;
  return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 shadow-sm sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="flex items-center gap-2 text-lg font-bold text-white"><CalendarClock className="text-blue-300" size={20}/>Контроль оплат клиента</h2><p className="mt-1 text-sm text-slate-400">Обещанная сумма и срок. В нужный момент ORDA потребует связаться с клиентом и записать результат.</p></div>
      {!readOnly && balance > 0 ? <button type="button" onClick={() => setOpen((value) => !value)} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white"><Plus size={17}/>{open ? "Закрыть" : "Запланировать доплату"}</button> : null}
    </div>
    {open ? <div className="mt-4 grid gap-3 rounded-xl border border-blue-500/25 bg-blue-500/5 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="text-sm text-slate-300">Сумма<input autoFocus type="number" min="0.01" max={balance} step="0.01" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={control}/></label>
      <label className="text-sm text-slate-300">Клиент обещал оплатить<input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} className={control}/></label>
      <button type="button" disabled={saving} onClick={() => void create()} className="min-h-11 rounded-xl bg-emerald-700 px-5 font-semibold text-white disabled:opacity-50">Сохранить</button>
    </div> : null}
    {error ? <p role="alert" className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}
    {loading && !items.length ? <div className="mt-4 h-20 animate-pulse rounded-xl bg-slate-900"/> : null}
    {!loading && !items.length ? <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">Обещанных доплат пока нет. Текущий остаток: {money(balance)}.</p> : null}
    {items.length ? <div className="mt-4 space-y-2">{items.map((item) => {
      const terminal = ["COMPLETED", "CANCELLED"].includes(item.status);
      const label = item.status === "COMPLETED" ? "Выполнено" : item.status === "CANCELLED" ? "Отменено" : item.overdue ? "Просрочено" : item.acknowledgedAt ? "Менеджер ознакомлен" : "Запланировано";
      return <article key={item.id} className={`rounded-xl border p-4 ${item.overdue ? "border-red-500/40 bg-red-500/5" : terminal ? "border-slate-800 bg-slate-950/40" : "border-blue-500/20 bg-slate-950/50"}`}>
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-bold text-white">{money(item.expectedAmount)}</p><p className="mt-1 text-sm text-slate-400">{date(item.dueAt)} · {item.assignee.name}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${item.overdue ? "bg-red-500/15 text-red-200" : item.status === "COMPLETED" ? "bg-emerald-500/15 text-emerald-200" : "bg-blue-500/15 text-blue-200"}`}>{label}</span></div>
        {item.resultText ? <p className="mt-3 rounded-lg bg-slate-900 p-3 text-sm text-slate-300">{item.resultText}</p> : null}
        {!terminal ? <div className="mt-3 flex flex-wrap gap-2"><a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold"><MessageCircle size={16}/>WhatsApp</a><button type="button" disabled={saving} onClick={() => void cancel(item.id)} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-700 px-3 text-sm text-slate-300 disabled:opacity-50"><Trash2 size={15}/>Отменить</button></div> : item.status === "COMPLETED" ? <p className="mt-3 flex items-center gap-2 text-sm text-emerald-300"><CheckCircle2 size={16}/>Результат зафиксирован</p> : null}
      </article>;
    })}</div> : null}
    {active.length > 0 ? <p className="mt-3 text-xs text-slate-500">Если оплата поступит раньше, зарегистрируйте её через «Добавить оплату» — покрытое напоминание закроется автоматически.</p> : null}
  </section>;
}
