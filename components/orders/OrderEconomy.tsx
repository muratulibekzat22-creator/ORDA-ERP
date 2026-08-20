import Link from "next/link";

import type { NumericValue, OrderTabData } from "./tabs/types";

const money = (value: NumericValue) => `${Number(value).toLocaleString("ru-RU")} ₸`;
const percent = (value: NumericValue) => `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}%`;
const date = (value: Date | string | null) => value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "—";

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`flex min-w-0 items-start justify-between gap-3 border-b border-slate-800 py-2 last:border-0 ${strong ? "font-bold text-white" : "text-slate-300"}`}>
    <span className="min-w-0">{label}</span><span className="shrink-0 text-right">{value}</span>
  </div>;
}

export default function OrderEconomy({ order }: { order: OrderTabData }) {
  const economy = order.economy;
  if (!economy) return null;
  return <section id="order-economy" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] shadow-sm">
    <div className="border-b border-slate-800 p-4 md:p-5">
      <h2 className="text-lg font-semibold text-white">Экономика заказа</h2>
      <p className="mt-1 text-sm text-slate-400">Начисления и фактические выплаты разделены; показатели рассчитаны backend-ом.</p>
    </div>
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
          <Row label="Статус оплаты" value={economy.client.status}/>
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
          <Row label="Статус взаиморасчёта" value={economy.partner.status}/>
        </div>
        <Link href={`/partner-management?orderId=${order.id}`} className="mt-4 inline-flex min-h-10 items-center rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white">Открыть полный расчёт партнёра</Link>
      </article>
      <article className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <h3 className="font-semibold text-emerald-200">Прибыль компании</h3>
        <div className="mt-3 text-sm">
          <Row label="Сумма продажи" value={money(economy.profit.totalSale)}/>
          <Row label="Стоимость партнёра" value={`− ${money(economy.profit.partnerCost)}`}/>
          <Row label="Материалы вне стоимости цеха" value={`− ${money(economy.profit.materials)}`}/>
          <Row label="Доставка" value={`− ${money(economy.profit.delivery)}`}/>
          <Row label="Подрядчики" value={`− ${money(economy.profit.contractors)}`}/>
          <Row label="Банковские комиссии" value={`− ${money(economy.profit.bankFees)}`}/>
          <Row label="Другие прямые расходы" value={`− ${money(economy.profit.otherDirectExpenses)}`}/>
          <Row label="Маржа до зарплаты" value={money(economy.profit.marginBeforePayroll)} strong/>
          <Row label="Бонус менеджера" value={money(economy.profit.managerBonus)}/>
          <Row label="Замерщик" value={money(economy.profit.measurer)}/>
          <Row label="Установщики" value={money(economy.profit.installers)}/>
          <Row label="Водитель" value={money(economy.profit.driver)}/>
          <Row label="Экспедитор" value={money(economy.profit.expediter)}/>
          <Row label="Другие начисления" value={money(economy.profit.otherPayroll)}/>
          <Row label="Зарплата по заказу" value={money(economy.profit.payrollAccrued)} strong/>
          <Row label="Чистая прибыль" value={money(economy.profit.netProfit)} strong/>
          <Row label="Чистая маржа" value={percent(economy.profit.netMarginPercent)} strong/>
        </div>
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
