import ProjectPayments from "@/components/project/ProjectPayments";
import type { OrderTabData } from "./types";

function money(value: OrderTabData["amount"]) {
  return `${Number(value).toLocaleString("ru-RU")} ₸`;
}

export default function FinanceTab({ order }: { order: OrderTabData }) {
  const cards = [
    ["Стоимость клиенту", order.amount, "text-green-400"],
    ["Предоплата", order.prepayment, "text-blue-400"],
    ["Остаток клиента", order.balance, "text-orange-400"],
    ["Стоимость партнёра", order.partnerPrice, "text-cyan-400"],
    ["Выплачено партнёру", order.partnerPaid, "text-sky-400"],
    ["Прибыль", order.companyProfit, "text-green-500"],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(([title, value, color]) => (
          <div key={title} className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
            <p className="text-sm text-slate-400">{title}</p>
            <p className={`mt-2 text-2xl font-bold ${color}`}>{money(value)}</p>
          </div>
        ))}
      </div>

      <ProjectPayments orderId={order.id} />
    </div>
  );
}
