"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Plus } from "lucide-react";

type Category = { id: number; code: string; name: string };
type Plan = {
  id: number;
  name: string;
  categoryId: number;
  category: Category;
  amount: number;
  dayOfMonth: number;
  method: string;
  counterparty: string | null;
  comment: string | null;
  active: boolean;
  posted: boolean;
};
type Data = {
  period: string;
  plans: Plan[];
  categories: Category[];
  totals: { planned: number; posted: number; pending: number };
};
type PlanForm = {
  id?: number;
  name: string;
  categoryId: string;
  amount: string;
  dayOfMonth: string;
  method: string;
  counterparty: string;
  comment: string;
};

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const blank = (): PlanForm => ({ name: "", categoryId: "", amount: "", dayOfMonth: "1", method: "bank_transfer", counterparty: "", comment: "" });
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const methods: Record<string, string> = { cash: "Наличные", kaspi: "Kaspi", bank_transfer: "Банк", card: "Карта", other: "Другое" };

export default function RecurringExpensesPanel({ onChanged }: { onChanged: () => void }) {
  const { data: session } = useSession();
  const director = session?.user.role === "DIRECTOR" || session?.user.role === "OPERATIONS_DIRECTOR";
  const [period, setPeriod] = useState(currentMonth());
  const [data, setData] = useState<Data | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [busy, setBusy] = useState<number | "form" | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(`/api/finance/recurring?period=${period}`, { cache: "no-store" });
    const body = await response.json() as Data & { error?: string };
    if (!response.ok) return setError(body.error ?? "Не удалось загрузить постоянные расходы");
    setData(body);
    setError("");
  }, [period]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy("form"); setError(""); setMessage("");
    const response = await fetch("/api/finance/recurring", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, categoryId: Number(form.categoryId), amount: Number(form.amount), dayOfMonth: Number(form.dayOfMonth) }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось сохранить постоянный расход");
    else { setMessage(form.id ? "План обновлён" : "Постоянный расход добавлен"); setForm(null); await load(); }
    setBusy(null);
  }

  async function post(plan: Plan) {
    setBusy(plan.id); setError(""); setMessage("");
    const response = await fetch("/api/finance/recurring", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "post", planId: plan.id, period }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось провести расход");
    else { setMessage(`${plan.name}: расход проведён за выбранный месяц`); await load(); onChanged(); }
    setBusy(null);
  }

  async function toggle(plan: Plan) {
    setBusy(plan.id); setError("");
    const response = await fetch("/api/finance/recurring", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: plan.id, active: !plan.active }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) setError(body.error ?? "Не удалось изменить план"); else await load();
    setBusy(null);
  }

  function edit(plan: Plan) {
    setForm({ id: plan.id, name: plan.name, categoryId: String(plan.categoryId), amount: String(plan.amount), dayOfMonth: String(plan.dayOfMonth), method: plan.method, counterparty: plan.counterparty ?? "", comment: plan.comment ?? "" });
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white"><CalendarClock className="text-blue-300" />Постоянные расходы</h2>
          <p className="mt-1 text-sm text-slate-400">План не списывает деньги сам: директор подтверждает расход за каждый месяц.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input aria-label="Месяц постоянных расходов" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
          {director && <button type="button" onClick={() => setForm(blank())} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 font-semibold text-white"><Plus size={17} />Добавить план</button>}
        </div>
      </div>
      {data && <div className="mt-4 grid grid-cols-3 gap-2"><Mini label="План" value={money(data.totals.planned)} /><Mini label="Проведено" value={money(data.totals.posted)} /><Mini label="Ожидает" value={money(data.totals.pending)} /></div>}
      <div className="mt-4 rounded-xl border border-blue-900 bg-blue-950/20 p-3 text-sm text-blue-100">
        Оклады менеджеров, директора и бонусы ведутся в <Link href="/payroll" className="font-semibold underline">«Зарплатах»</Link> — здесь их повторно добавлять не нужно.
      </div>
      {message && <p role="status" className="mt-3 rounded-xl bg-emerald-950/40 p-3 text-sm text-emerald-200">{message}</p>}
      {error && <p role="alert" className="mt-3 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
      {form && <form onSubmit={submit} className="mt-4 grid gap-3 rounded-xl border border-blue-800 bg-slate-950/50 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="Название"><input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="input" /></Input>
        <Input label="Категория"><select required value={form.categoryId} onChange={(event) => setForm({ ...form, categoryId: event.target.value })} className="input"><option value="">Выберите</option>{data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></Input>
        <Input label="Сумма"><input required min="1" type="number" value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className="input" /></Input>
        <Input label="День месяца"><input required min="1" max="28" type="number" value={form.dayOfMonth} onChange={(event) => setForm({ ...form, dayOfMonth: event.target.value })} className="input" /></Input>
        <Input label="Способ оплаты"><select value={form.method} onChange={(event) => setForm({ ...form, method: event.target.value })} className="input">{Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Input>
        <Input label="Контрагент"><input value={form.counterparty} onChange={(event) => setForm({ ...form, counterparty: event.target.value })} className="input" /></Input>
        <Input label="Комментарий"><input value={form.comment} onChange={(event) => setForm({ ...form, comment: event.target.value })} className="input" /></Input>
        <div className="flex items-end gap-2"><button disabled={busy === "form"} className="min-h-11 flex-1 rounded-xl bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">Сохранить</button><button type="button" onClick={() => setForm(null)} className="min-h-11 rounded-xl bg-slate-700 px-4 text-white">Отмена</button></div>
      </form>}
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {data?.plans.map((plan) => <article key={plan.id} className={`rounded-xl border p-4 ${plan.active ? "border-slate-700 bg-slate-950/50" : "border-slate-800 opacity-60"}`}>
          <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-white">{plan.name}</h3><p className="mt-1 text-sm text-slate-400">{plan.category.name} · до {plan.dayOfMonth}-го числа · {methods[plan.method] ?? plan.method}</p></div><b className="whitespace-nowrap text-white">{money(plan.amount)}</b></div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{plan.posted ? <span className="flex items-center gap-1 text-sm font-semibold text-emerald-300"><CheckCircle2 size={16} />Проведено</span> : plan.active ? <button type="button" disabled={busy === plan.id} onClick={() => void post(plan)} className="min-h-10 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white disabled:opacity-50">Провести за месяц</button> : <span className="text-sm text-slate-500">Приостановлено</span>}{director && <><button type="button" onClick={() => edit(plan)} className="min-h-10 rounded-lg bg-slate-800 px-3 text-sm text-white">Изменить</button><button type="button" disabled={busy === plan.id} onClick={() => void toggle(plan)} className="min-h-10 rounded-lg bg-slate-800 px-3 text-sm text-slate-300">{plan.active ? "Пауза" : "Включить"}</button></>}</div>
        </article>)}
      </div>
      <p className="mt-4 text-xs text-slate-500">Для разовых расходов используйте «+ Расход»: доступны реклама/таргет, ПО, подписки, съёмки, бензин, транспорт, налоги, офис и другие категории.</p>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-slate-900 p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 break-words font-semibold text-white">{value}</p></div>; }
function Input({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-sm text-slate-300"><span className="mb-1 block">{label}</span>{children}</label>; }
