"use client";

interface Props {
  totalLeads: number;
  measurements: number;
  proposals: number;
  contracts: number;
}

export default function SalesAnalytics({
  totalLeads,
  measurements,
  proposals,
  contracts,
}: Props) {
  const measurementRate =
    totalLeads > 0
      ? Math.round((measurements / totalLeads) * 100)
      : 0;

  const proposalRate =
    measurements > 0
      ? Math.round((proposals / measurements) * 100)
      : 0;

  const contractRate =
    proposals > 0
      ? Math.round((contracts / proposals) * 100)
      : 0;

  const cards = [
    {
      title: "Заявки",
      value: totalLeads,
      color: "text-blue-400",
      icon: "📞",
    },
    {
      title: "Замеры",
      value: measurements,
      color: "text-yellow-400",
      icon: "📐",
    },
    {
      title: "КП",
      value: proposals,
      color: "text-purple-400",
      icon: "📄",
    },
    {
      title: "Договоры",
      value: contracts,
      color: "text-green-400",
      icon: "🤝",
    },
  ];

  return (
    <div className="space-y-8">

      <div className="grid grid-cols-4 gap-6">

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

                <h2 className={`mt-3 text-4xl font-bold ${card.color}`}>
                  {card.value}
                </h2>

              </div>

              <div className="text-5xl">
                {card.icon}
              </div>

            </div>

          </div>

        ))}

      </div>

      <div className="grid grid-cols-3 gap-6">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-3 text-xl font-bold text-white">
            Конверсия в замер
          </h2>

          <p className="text-5xl font-bold text-yellow-400">
            {measurementRate}%
          </p>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-3 text-xl font-bold text-white">
            Конверсия в КП
          </h2>

          <p className="text-5xl font-bold text-blue-400">
            {proposalRate}%
          </p>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-3 text-xl font-bold text-white">
            Конверсия в договор
          </h2>

          <p className="text-5xl font-bold text-green-400">
            {contractRate}%
          </p>

        </div>

      </div>

    </div>
  );
}