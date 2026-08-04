"use client";

interface Props {
  income: number;
  expenses: number;
  debt: number;
}

export default function FinanceDashboard({
  income,
  expenses,
  debt,
}: Props) {
  const profit = income - expenses;

  const profitability =
    income > 0 ? Math.round((profit / income) * 100) : 0;

  const cards = [
    {
      title: "Доход",
      value: income,
      color: "text-green-400",
      icon: "💰",
    },
    {
      title: "Расход",
      value: expenses,
      color: "text-red-400",
      icon: "📉",
    },
    {
      title: "Прибыль",
      value: profit,
      color: "text-blue-400",
      icon: "📈",
    },
    {
      title: "Дебиторская задолженность",
      value: debt,
      color: "text-yellow-400",
      icon: "⏳",
    },
  ];

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">

        {cards.map((card) => (

          <div
            key={card.title}
            className="rounded-2xl border border-slate-700 bg-[#101827] p-6"
          >

            <div className="flex items-center justify-between">

              <div>

                <p className="text-slate-400">
                  {card.title}
                </p>

                <h2 className={`mt-3 text-3xl font-bold ${card.color}`}>
                  {card.value.toLocaleString()} ₸
                </h2>

              </div>

              <div className="text-5xl">
                {card.icon}
              </div>

            </div>

          </div>

        ))}

      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            Рентабельность
          </p>

          <h2 className="mt-3 text-4xl font-bold text-green-400">
            {profitability}%
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            Денежный поток
          </p>

          <h2 className="mt-3 text-4xl font-bold text-cyan-400">
            {(income - expenses).toLocaleString()} ₸
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <p className="text-slate-400">
            Финансовое состояние
          </p>

          <h2
            className={`mt-3 text-2xl font-bold ${
              profit >= 0 ? "text-green-400" : "text-red-400"
            }`}
          >
            {profit >= 0 ? "Прибыль" : "Убыток"}
          </h2>

        </div>

      </div>

    </div>
  );
}