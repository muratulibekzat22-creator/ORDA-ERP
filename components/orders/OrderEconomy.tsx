"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import type { NumericValue, OrderTabData } from "./tabs/types";

const numeric = (value: NumericValue) => {
  const result = Number(value);
  return Math.abs(result) < 0.005 ? 0 : result;
};
const money = (value: NumericValue) => `${numeric(value).toLocaleString("ru-RU")} ₸`;
const expense = (value: NumericValue) =>
  numeric(value) === 0 ? money(0) : `− ${money(value)}`;
const percent = (value: NumericValue) => `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const date = (value: Date | string | null) => value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "—";
const statuses: Record<string, string> = {
  NOT_ASSIGNED: "Не передан в цех",
  COST_MISSING: "Стоимость не указана",
  NOT_ACCRUED: "Не начислено",
  PAYABLE: "Не оплачено",
  PARTIALLY_PAID: "Частично оплачено",
  PARTIAL: "Частично оплачено",
  UNPAID: "Не оплачено",
  PAID: "Оплачено",
  OVERPAID: "Переплата",
  OVERDUE: "Просрочено",
  DISPUTED: "Спорный расчёт",
};

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex min-w-0 items-start justify-between gap-3 border-b border-slate-800 py-2 last:border-0 ${strong ? "font-bold text-white" : "text-slate-300"}`}>
    <span className="min-w-0">{label}</span><span className="shrink-0 text-right">{value}</span>
  </div>;
}

export default function OrderEconomy({ order }: { order: OrderTabData }) {
  const router = useRouter();
  const economy = order.economy;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    materialOutsideWorkshop: String(order.costPlan?.materialOutsideWorkshop ?? 0),
    delivery: String(order.costPlan?.delivery ?? 0),
    bankFees: String(order.costPlan?.bankFees ?? 0),
    otherDirect: String(order.costPlan?.otherDirect ?? 0),
    confirmed: Boolean(order.costPlan?.confirmedAt),
  });
  if (!economy) return null;
  async function saveCosts(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}/economy`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "saveCostPlan", ...form }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить расходы");
      setEditing(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить расходы");
    } finally {
      setSaving(false);
    }
  }
  return <section id="order-economy" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] shadow-sm">
    <div className="flex flex-col gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-start sm:justify-between md:p-5">
      <div>
      <h2 className="text-lg font-semibold text-white">Прибыль компании</h2>
      <p className="mt-1 text-sm text-slate-400">Начисления и фактические выплаты разделены; показатели рассчитаны backend-ом.</p>
      </div>
      <button type="button" onClick={() => setEditing((value) => !value)} className="min-h-10 rounded-lg bg-slate-800 px-3 text-sm font-semibold text-white">
        Изменить расходы и начисления
      </button>
    </div>
    {error && <p role="alert" className="m-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-200">{error}</p>}
    {editing && <form onSubmit={saveCosts} className="grid gap-3 border-b border-slate-800 p-4 sm:grid-cols-2 lg:grid-cols-4 md:p-5">
      {([
        ["materialOutsideWorkshop", "Материал вне стоимости цеха"],
        ["delivery", "Доставка"],
        ["bankFees", "Банковские комиссии"],
        ["otherDirect", "Другие прямые расходы"],
      ] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm text-slate-300"><span>{label}</span><input type="number" min="0" step="0.01" required value={form[key]} onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} className="min-h-11 rounded-xl border border-slate-700 bg-slate-950 px-3 text-white"/></label>)}
      <label className="flex min-h-11 items-center gap-2 text-sm text-slate-200 sm:col-span-2 lg:col-span-3"><input type="checkbox" checked={form.confirmed} onChange={(event) => setForm((current) => ({ ...current, confirmed: event.target.checked }))}/>Все прямые расходы по заказу подтверждены</label>
      <button disabled={saving} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50">Сохранить расходы</button>
      <p className="text-xs text-slate-500 sm:col-span-2 lg:col-span-4">Плановые расходы не создают движение денег в Finance. Денежная операция появится только при фактической оплате.</p>
    </form>}
    <div className="grid gap-4 p-4 lg:grid-cols-3 md:p-5">
      <article className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4">
        <h3 className="font-semibold text-blue-200">Расчёты с клиентом</h3>
        <div className="mt-3 text-sm">
          <Row label="Сумма договора" value={money(economy.client.contractAmount)}/>
          <Row label="Дополнительные работы" value={money(economy.client.additionalWorks)}/>
          <Row label="Скидка" value={money(economy.client.discounts)}/>
          <Row label="Сумма продажи" value={money(economy.client.totalSale)} strong/>
          <Row label="Получено от клиента" value={money(economy.client.receivedGross)}/>
          <Row label="Возвраты клиенту" value={money(economy.client.refunds)}/>
          <Row label="Чистая полученная сумма" value={money(economy.client.netReceived)}/>
          <Row label="Остаток клиента" value={money(economy.client.remaining)} strong/>
          <Row label="Срок следующей оплаты" value={date(economy.client.dueAt)}/>
          <Row label="Просроченная сумма" value={money(economy.client.overdueAmount)}/>
          <Row label="Статус оплаты" value={statuses[economy.client.status] ?? economy.client.status}/>
        </div>
      </article>
      <article className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <h3 className="font-semibold text-amber-200">Партнёр или цех</h3>
        <p className="mt-1 text-sm text-slate-400">{order.partner?.name ?? "Не назначен"}</p>
        <div className="mt-3 text-sm">
          <Row label="Согласованная стоимость" value={money(economy.partner.agreed)}/>
          <Row label="Дата согласования" value={date(economy.partner.agreedAt)}/>
          <Row label="Кто согласовал" value={economy.partner.agreedBy ?? "—"}/>
          <Row label="Начислено партнёру" value={money(economy.partner.accrued)}/>
          <Row label="Выплачено партнёру" value={money(economy.partner.paid)}/>
          <Row label="Осталось выплатить" value={money(economy.partner.remaining)} strong/>
          <Row label="Срок выплаты" value={date(economy.partner.dueAt)}/>
          <Row label="Статус взаиморасчёта" value={statuses[economy.partner.status] ?? economy.partner.status}/>
        </div>
        <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("orda:open-partner-history", { detail: { orderId: order.id } }))} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white">История и полный расчёт</button>
      </article>
      <article className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <h3 className="font-semibold text-emerald-200">Прибыль компании</h3>
        <p className="mt-1 text-sm font-medium text-emerald-100">{economy.profit.label}</p>
        {economy.profit.warning && <p className="mt-3 rounded-xl border border-amber-400/20 bg-amber-950/30 p-3 text-sm text-amber-100">{economy.profit.warning}</p>}
        <div className="mt-3 text-sm">
          <Row label="Сумма продажи" value={money(economy.profit.totalSale)}/>
          <Row label="Стоимость цеха" value={economy.profit.complete ? expense(economy.profit.partnerCost) : "Не указана"}/>
          <Row label="Материалы вне стоимости цеха" value={expense(economy.profit.materials)}/>
          <Row label="Доставка" value={expense(economy.profit.delivery)}/>
          <Row label="Банковские комиссии" value={expense(economy.profit.bankFees)}/>
          <Row label="Другие прямые расходы" value={expense(economy.profit.otherDirectExpenses)}/>
          <Row label="Маржа до зарплаты" value={economy.profit.complete ? money(economy.profit.marginBeforePayroll) : "—"} strong/>
          <Row label="Бонус менеджера" value={money(economy.profit.managerBonus)}/>
          <Row label="Замерщик" value={money(economy.profit.measurer)}/>
          <Row label="Водитель" value={money(economy.profit.driver)}/>
          <Row label="Другие начисления" value={money(economy.profit.otherPayroll)}/>
          <Row label="Всего начислено по заказу" value={money(economy.profit.payrollAccrued)} strong/>
          <Row label="Прибыль заказа" value={economy.profit.complete ? money(economy.profit.netProfit) : "—"} strong/>
          <Row label="Чистая маржа заказа" value={economy.profit.complete && numeric(economy.profit.totalSale) !== 0 ? percent(economy.profit.netMarginPercent) : "—"} strong/>
          <Row label="Рентабельность / чистая маржа" value={economy.profit.complete && numeric(economy.profit.totalSale) !== 0 ? percent(economy.profit.netMarginPercent) : "—"} strong/>
          <Row label="Полнота расчёта" value={economy.profit.costsConfirmed ? "Расходы подтверждены" : "Требует подтверждения расходов"}/>
        </div>
        <details className="mt-4 rounded-xl border border-emerald-400/20 bg-slate-950/30 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-emerald-100">План / факт прямых расходов</summary>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[430px] text-xs text-slate-300">
              <thead><tr className="text-left text-slate-500"><th className="pb-2">Расход</th><th className="pb-2 text-right">План</th><th className="pb-2 text-right">Факт</th><th className="pb-2 text-right">Отклонение</th></tr></thead>
              <tbody>{([
                ["Материал вне цеха", "materials"],
                ["Доставка", "delivery"],
                ["Банковские комиссии", "bankFees"],
                ["Другие прямые", "otherDirect"],
                ["Всего", "total"],
              ] as const).map(([label, key]) => <tr key={key} className="border-t border-slate-800"><th className="py-2 text-left font-medium">{label}</th><td className="py-2 text-right">{money(economy.directCosts.plan[key])}</td><td className="py-2 text-right">{money(economy.directCosts.fact[key])}</td><td className={`py-2 text-right ${numeric(economy.directCosts.deviation[key]) > 0 ? "text-rose-300" : "text-emerald-300"}`}>{money(economy.directCosts.deviation[key])}</td></tr>)}</tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-slate-500">Активный заказ использует подтверждённый план. Завершённый заказ использует только фактические проводки Finance с orderId.</p>
        </details>
      </article>
    </div>
    <details className="border-t border-slate-800 p-4 md:p-5">
      <summary className="cursor-pointer font-semibold text-blue-300">Фактическое движение денег</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Row label="Получено" value={money(economy.cash.clientReceived)}/>
        <Row label="Партнёру" value={money(economy.cash.partnerPaid)}/>
        <Row label="Сотрудникам" value={money(economy.cash.payrollPaid)}/>
        <Row label="Другие расходы" value={money(economy.cash.otherExpensesPaid)}/>
        <Row label="Денежный остаток" value={money(economy.cash.balance)} strong/>
      </div>
    </details>
  </section>;
}
