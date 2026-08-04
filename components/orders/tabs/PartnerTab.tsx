import type { NumericValue, OrderTabData } from "./types";

function money(value: NumericValue) {
  return `${Number(value).toLocaleString("ru-RU")} ₸`;
}

export default function PartnerTab({ order }: { order: OrderTabData }) {
  if (!order.partner) {
    return <EmptyState text="Для этого заказа партнёр пока не назначен." />;
  }

  const details = [
    ["Партнёр", order.partner.name],
    ["Телефон", order.partner.phone ?? "—"],
    ["E-mail", order.partner.email ?? "—"],
    ["Город", order.partner.city ?? "—"],
    ["Статус", order.partner.active ? "Активен" : "Неактивен"],
  ];
  const finance = [
    ["Стоимость партнёра", order.partnerPrice, "text-cyan-400"],
    ["Выплачено партнёру", order.partnerPaid, "text-sky-400"],
    ["Остаток партнёру", order.partnerBalance, "text-yellow-400"],
    ["Прибыль компании", order.companyProfit, "text-green-400"],
  ] as const;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {details.map(([title, value]) => (
          <div key={title} className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
            <p className="text-sm text-slate-400">{title}</p>
            <p className="mt-2 text-lg font-semibold text-white">{value}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {finance.map(([title, value, color]) => (
          <div key={title} className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
            <p className="text-sm text-slate-400">{title}</p>
            <p className={`mt-2 text-2xl font-bold ${color}`}>{money(value)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-slate-400">{text}</div>;
}
