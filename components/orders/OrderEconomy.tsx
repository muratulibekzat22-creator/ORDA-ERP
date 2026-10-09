import type { NumericValue, OrderTabData } from "./tabs/types";

const money = (value: NumericValue | null) =>
  value === null
    ? "Недостаточно данных"
    : `${Number(value).toLocaleString("ru-RU")} ₸`;
const percent = (value: NumericValue | null) =>
  value === null
    ? "Недостаточно данных"
    : `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} %`;

function Row({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex min-w-0 items-start justify-between gap-3 border-b border-slate-800 py-2 last:border-0 ${
        strong ? "font-bold text-white" : "text-slate-300"
      }`}
    >
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 text-right">{value}</span>
    </div>
  );
}

export default function OrderEconomy({ order }: { order: OrderTabData }) {
  const economy = order.economy;
  if (!economy) return null;
  const totalCost =
    Number(economy.profit.directExpenses) +
    Number(economy.profit.payrollAccrued);

  return (
    <section
      id="order-economy"
      className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] shadow-sm"
    >
      <div className="border-b border-slate-800 p-4 md:p-5">
        <h2 className="text-lg font-semibold text-white">Экономика заказа</h2>
        <p className="mt-1 text-sm text-slate-400">
          Себестоимость считается на сервере без повторного учёта выплат.
        </p>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-2 md:p-5">
        <article className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
          <h3 className="font-semibold text-blue-200">Себестоимость</h3>
          <div className="mt-3 text-sm">
            <Row label="Сумма продажи" value={money(economy.profit.totalSale)} />
            <Row label="Подрядчик / производство" value={money(economy.profit.partnerCost)} />
            <Row label="Материалы" value={money(economy.profit.materials)} />
            <Row label="Доставка" value={money(economy.profit.delivery)} />
            <Row label="Монтаж и подрядчики" value={money(economy.profit.contractors)} />
            <Row label="Банковские комиссии" value={money(economy.profit.bankFees)} />
            <Row label="Другие прямые расходы" value={money(economy.profit.otherDirectExpenses)} />
            <Row label="Зарплата по заказу" value={money(economy.profit.payrollAccrued)} />
            <Row label="Общая себестоимость" value={money(totalCost)} strong />
          </div>
        </article>
        <article className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <h3 className="font-semibold text-emerald-200">Результат</h3>
          <div className="mt-3 text-sm">
            <Row label="Получено от клиента" value={money(economy.client.netReceived)} />
            <Row label="Остаток клиента" value={money(economy.client.remaining)} />
            <Row label="Маржа до зарплаты" value={money(economy.profit.marginBeforePayroll)} />
            <Row label="Чистая прибыль" value={money(economy.profit.netProfit)} strong />
            <Row label="Чистая маржа" value={percent(economy.profit.netMarginPercent)} strong />
          </div>
          {!economy.profit.dataComplete ? (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
              Заполните стоимость подрядчика или производственную калькуляцию,
              чтобы увидеть прибыль и маржу.
            </p>
          ) : null}
        </article>
      </div>
      <details className="border-t border-slate-800 p-4 md:p-5">
        <summary className="cursor-pointer font-semibold text-blue-300">
          Фактическое движение денег
        </summary>
        <div className="mt-3 grid gap-x-5 sm:grid-cols-2 lg:grid-cols-5">
          <Row label="Получено" value={money(economy.cash.clientReceived)} />
          <Row label="Подрядчику" value={money(economy.cash.partnerPaid)} />
          <Row label="Сотрудникам" value={money(economy.cash.payrollPaid)} />
          <Row label="Другие расходы" value={money(economy.cash.otherExpensesPaid)} />
          <Row label="Денежный остаток" value={money(economy.cash.balance)} strong />
        </div>
      </details>
    </section>
  );
}
