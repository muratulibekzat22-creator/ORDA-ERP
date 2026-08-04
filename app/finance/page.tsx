"use client";

import { useEffect, useState } from "react";

type PaymentStatus = "all" | "debt" | "partial" | "paid";
type Period = "all" | "month" | "quarter" | "year";

type FinanceRow = {
  id: number;
  number: string;
  client: string;
  partner: string;
  manager: string;
  amount: number;
  prepayment: number;
  balance: number;
  partnerPrice: number;
  partnerPaid: number;
  partnerBalance: number;
  companyProfit: number;
  paymentStatus: Exclude<PaymentStatus, "all">;
};

type FinanceData = {
  rows: FinanceRow[];
  totals: {
    turnover: number;
    received: number;
    clientBalance: number;
    partnerPaid: number;
    partnerBalance: number;
    profit: number;
  };
  managers: string[];
  partners: Array<{ id: number; name: string }>;
};

const emptyData: FinanceData = {
  rows: [],
  totals: { turnover: 0, received: 0, clientBalance: 0, partnerPaid: 0, partnerBalance: 0, profit: 0 },
  managers: [],
  partners: [],
};

function money(value: number) {
  return `${value.toLocaleString("ru-RU")} ₸`;
}

function paymentStatusMeta(status: FinanceRow["paymentStatus"]) {
  if (status === "paid") return { title: "Оплачено", color: "bg-green-500/20 text-green-400" };
  if (status === "partial") return { title: "Частично", color: "bg-yellow-500/20 text-yellow-400" };
  return { title: "Есть долг", color: "bg-red-500/20 text-red-400" };
}

export default function FinancePage() {
  const [data, setData] = useState<FinanceData>(emptyData);
  const [period, setPeriod] = useState<Period>("all");
  const [manager, setManager] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("all");
  const [error, setError] = useState("");

  useEffect(() => {
    const params = new URLSearchParams({ period, paymentStatus });
    if (manager) params.set("manager", manager);
    if (partnerId) params.set("partnerId", partnerId);

    let active = true;

    void fetch(`/api/finance?${params.toString()}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить финансовые данные");
        return response.json() as Promise<FinanceData>;
      })
      .then((result) => {
        if (active) {
          setData(result);
          setError("");
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить финансовые данные");
        }
      });

    return () => {
      active = false;
    };
  }, [period, manager, partnerId, paymentStatus]);

  const cards = [
    ["Общий оборот", data.totals.turnover, "text-green-400"],
    ["Получено от клиентов", data.totals.received, "text-blue-400"],
    ["Остаток клиентов", data.totals.clientBalance, "text-red-400"],
    ["Выплачено партнёрам", data.totals.partnerPaid, "text-sky-400"],
    ["Осталось выплатить партнёрам", data.totals.partnerBalance, "text-yellow-400"],
    ["Прибыль компании", data.totals.profit, "text-cyan-400"],
  ] as const;

  return (
    <section className="space-y-8 p-8">
      <div>
        <h1 className="text-3xl font-bold text-white">Финансы</h1>
        <p className="mt-2 text-slate-400">Финансовая аналитика ORDA ERP</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {cards.map(([title, value, color]) => (
          <div key={title} className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
            <p className="text-slate-400">{title}</p>
            <p className={`mt-3 text-3xl font-bold ${color}`}>{money(value)}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-2 xl:grid-cols-4">
        <Filter label="Период" value={period} onChange={(value) => setPeriod(value as Period)}>
          <option value="all">За всё время</option><option value="month">Последний месяц</option><option value="quarter">Последний квартал</option><option value="year">Последний год</option>
        </Filter>
        <Filter label="Менеджер" value={manager} onChange={setManager}>
          <option value="">Все менеджеры</option>{data.managers.map((item) => <option key={item} value={item}>{item}</option>)}
        </Filter>
        <Filter label="Партнёр" value={partnerId} onChange={setPartnerId}>
          <option value="">Все партнёры</option>{data.partners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </Filter>
        <Filter label="Статус оплаты" value={paymentStatus} onChange={(value) => setPaymentStatus(value as PaymentStatus)}>
          <option value="all">Все статусы</option><option value="debt">Есть задолженность</option><option value="partial">Частичная оплата</option><option value="paid">Оплачено полностью</option>
        </Filter>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
        <table className="min-w-[1550px] w-full text-sm">
          <thead className="bg-slate-900 text-left text-slate-400">
            <tr>{["№ заказа", "Клиент", "Партнёр", "Стоимость клиенту", "Предоплата", "Остаток клиента", "Стоимость партнёра", "Выплачено партнёру", "Остаток партнёру", "Прибыль", "Статус оплаты"].map((title) => <th key={title} className="px-4 py-4 font-medium">{title}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((row) => {
              const status = paymentStatusMeta(row.paymentStatus);
              return <tr key={row.id} className="border-t border-slate-800 hover:bg-slate-900/70">
                <td className="px-4 py-4 font-medium text-white">{row.number}</td><td className="px-4 py-4 text-white">{row.client}</td><td className="px-4 py-4 text-slate-300">{row.partner}</td>
                <td className="px-4 py-4 text-green-400">{money(row.amount)}</td><td className="px-4 py-4 text-blue-400">{money(row.prepayment)}</td><td className="px-4 py-4 text-red-400">{money(row.balance)}</td>
                <td className="px-4 py-4 text-cyan-400">{money(row.partnerPrice)}</td><td className="px-4 py-4 text-sky-400">{money(row.partnerPaid)}</td><td className="px-4 py-4 text-yellow-400">{money(row.partnerBalance)}</td>
                <td className="px-4 py-4 font-semibold text-green-400">{money(row.companyProfit)}</td><td className="px-4 py-4"><span className={`rounded-full px-3 py-1 ${status.color}`}>{status.title}</span></td>
              </tr>;
            })}
            {data.rows.length === 0 && <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">Нет заказов по выбранным фильтрам.</td></tr>}
          </tbody>
          <tfoot className="border-t border-slate-600 bg-slate-900 font-bold">
            <tr><td colSpan={3} className="px-4 py-4 text-white">Итого</td><td className="px-4 py-4 text-green-400">{money(data.totals.turnover)}</td><td colSpan={1} /><td className="px-4 py-4 text-red-400">{money(data.totals.clientBalance)}</td><td colSpan={3} /><td className="px-4 py-4 text-cyan-400">{money(data.totals.profit)}</td><td /></tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Filter({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="space-y-2 text-sm text-slate-300"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500">{children}</select></label>;
}
