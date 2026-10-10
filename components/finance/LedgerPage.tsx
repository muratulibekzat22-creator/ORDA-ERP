"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";
import {
  COMPANY_EXPENSE_OPTIONS,
  COMPANY_INCOME_OPTIONS,
} from "@/lib/finance/company-entry-options";

type Entry = { id: number; type: string; category: string; direction: "INCOME" | "EXPENSE"; amount: string; operationDate: string; comment: string | null };
type LedgerData = { entries: Entry[]; totals: Record<string, number | null> };
const money = (value: number | string | null) => value === null ? "Недостаточно данных" : `${Number(value).toLocaleString("ru-RU")} ₸`;
const personalIncomeOptions = [["OTHER", "Прочий личный доход"]] as const;
const personalExpenseOptions = [
  ["FOOD", "Питание"],
  ["PERSONAL_FUEL", "Топливо"],
  ["LOAN", "Кредит / заём"],
  ["HOUSING", "Жильё"],
  ["CAR", "Автомобиль"],
  ["TRAVEL", "Поездки"],
  ["FAMILY", "Семья"],
  ["PERSONAL_PURCHASE", "Личные покупки"],
  ["OTHER", "Прочее"],
] as const;
const totalLabels: Record<string, string> = {
  revenue: "Выручка по заказам",
  directExpenses: "Прямые расходы",
  additionalIncome: "Дополнительные доходы",
  operatingExpenses: "Расходы компании",
  payrollAccrued: "Начислено зарплаты",
  payrollPaid: "Выплачено зарплаты",
  netProfit: "Чистая прибыль",
  netMargin: "Рентабельность",
  income: "Все доходы",
  expense: "Все расходы",
  balance: "Итог",
};

export default function LedgerPage({ personal = false }: { personal?: boolean }) {
  const endpoint = personal ? "/api/personal-finance" : "/api/company-finance";
  const [data, setData] = useState<LedgerData>({ entries: [], totals: {} });
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ direction: "EXPENSE", category: personal ? "OTHER" : "ADDITIONAL_EXPENSE", amount: "", operationDate: new Date().toISOString().slice(0, 10), comment: "" });
  const { getKey, reset } = useIdempotencyKey();
  const load = useCallback(async () => { setLoading(true); try { const response = await fetch(endpoint); const value = await response.json() as LedgerData & { error?: string }; if (!response.ok) throw new Error(value.error ?? "Не удалось загрузить данные"); setData(value); setError(""); } catch (value) { setError(value instanceof Error ? value.message : "Не удалось загрузить данные"); } finally { setLoading(false); } }, [endpoint]);
  useEffect(() => {
    // Fetching is the effect's external synchronization; state updates happen after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);
  async function submit(event: FormEvent) { event.preventDefault(); setSaving(true); try { const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": getKey() }, body: JSON.stringify({ ...form, type: form.direction }) }); const value = await response.json() as { error?: string }; if (!response.ok) throw new Error(value.error ?? "Не удалось сохранить операцию"); reset(); setForm((item) => ({ ...item, amount: "", comment: "" })); await load(); } catch (value) { setError(value instanceof Error ? value.message : "Не удалось сохранить операцию"); } finally { setSaving(false); } }
  const categoryOptions = form.direction === "INCOME"
    ? (personal ? personalIncomeOptions : COMPANY_INCOME_OPTIONS)
    : (personal ? personalExpenseOptions : COMPANY_EXPENSE_OPTIONS);
  const categoryLabels = Object.fromEntries([
    ...personalIncomeOptions,
    ...personalExpenseOptions,
    ...COMPANY_INCOME_OPTIONS,
    ...COMPANY_EXPENSE_OPTIONS,
  ]);
  return <section className="space-y-6 p-5 md:p-8">
    <header><h1 className="text-3xl font-bold text-white">{personal ? "Личные финансы руководителя" : "Финансы компании"}</h1><p className="mt-1 text-slate-400">{personal ? "Защищённый личный учёт — доступ только директору" : "Операционные расходы, прочие доходы и чистая прибыль ALTYN SAPA"}</p></header>
    <form onSubmit={submit} className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-2 xl:grid-cols-5">
      <label className="text-sm text-slate-300">Направление<select className="input mt-1" value={form.direction} onChange={(e) => { const direction = e.target.value; const options = direction === "INCOME" ? (personal ? personalIncomeOptions : COMPANY_INCOME_OPTIONS) : (personal ? personalExpenseOptions : COMPANY_EXPENSE_OPTIONS); setForm({ ...form, direction, category: options[0][0] }); }}><option value="EXPENSE">Расход</option><option value="INCOME">Доход</option></select></label>
      <label className="text-sm text-slate-300">Категория<select required className="input mt-1" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{categoryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="text-sm text-slate-300">Сумма<input required type="number" inputMode="decimal" min="0.01" step="0.01" className="input mt-1" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label>
      <label className="text-sm text-slate-300">Дата<input required type="date" className="input mt-1" value={form.operationDate} onChange={(e) => setForm({ ...form, operationDate: e.target.value })} /></label>
      <button disabled={saving} className="min-h-12 self-end rounded-xl bg-green-600 px-5 font-semibold text-white disabled:opacity-50">{saving ? "Сохранение…" : "Добавить операцию"}</button>
      <label className="text-sm text-slate-300 md:col-span-2 xl:col-span-5">Комментарий<input className="input mt-1" maxLength={2000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></label>
    </form>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Object.entries(data.totals).map(([key, value]) => <div key={key} className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><p className="text-sm text-slate-400">{totalLabels[key] ?? key}</p><p className="mt-2 text-2xl font-bold text-white">{money(value)}</p></div>)}</div>
    {error && <p role="alert" className="rounded-xl bg-red-950/50 p-4 text-red-300">{error}</p>}{loading && <p role="status" className="text-slate-400">Загрузка операций…</p>}
    <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]"><table className="min-w-[700px] w-full text-left text-sm"><thead><tr><th>Дата</th><th>Направление</th><th>Категория</th><th>Комментарий</th><th>Сумма</th></tr></thead><tbody>{data.entries.map((entry) => <tr key={entry.id}><td>{new Date(entry.operationDate).toLocaleDateString("ru-RU")}</td><td>{entry.direction === "INCOME" ? "Доход" : "Расход"}</td><td>{categoryLabels[entry.category] ?? entry.category}</td><td>{entry.comment ?? "—"}</td><td>{money(entry.amount)}</td></tr>)}{!data.entries.length && !loading && <tr><td colSpan={5} className="p-6 text-center text-slate-400">Операций пока нет.</td></tr>}</tbody></table></div>
  </section>;
}
