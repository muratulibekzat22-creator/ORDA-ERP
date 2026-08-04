"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";

const data = [
  {
    month: "Янв",
    revenue: 8.2,
    received: 5.4,
    profit: 2.3,
    debt: 2.8,
  },
  {
    month: "Фев",
    revenue: 12.5,
    received: 8.8,
    profit: 4.1,
    debt: 3.7,
  },
  {
    month: "Мар",
    revenue: 15.1,
    received: 11.6,
    profit: 5.3,
    debt: 3.5,
  },
  {
    month: "Апр",
    revenue: 10.4,
    received: 9.2,
    profit: 3.1,
    debt: 1.2,
  },
  {
    month: "Май",
    revenue: 18.8,
    received: 15.5,
    profit: 7.4,
    debt: 3.3,
  },
  {
    month: "Июн",
    revenue: 22.4,
    received: 18.1,
    profit: 9.2,
    debt: 4.3,
  },
];

export default function RevenueChart() {
  return (
    <div className="mt-8 rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <div className="mb-8 flex items-center justify-between">

        <div>

          <h2 className="text-2xl font-bold text-white">
            Финансовая аналитика
          </h2>

          <p className="mt-1 text-slate-400">
            Доход • Получено • Прибыль • Дебиторская задолженность
          </p>

        </div>

      </div>

      <div className="h-[420px]">

        <ResponsiveContainer width="100%" height="100%">

          <LineChart data={data}>

            <CartesianGrid
              stroke="#334155"
              strokeDasharray="4 4"
            />

            <XAxis
              dataKey="month"
              stroke="#94A3B8"
            />

            <YAxis
              stroke="#94A3B8"
              unit=" млн"
            />

            <Tooltip
              formatter={(value) =>
                value === undefined ? "" : `${value} млн ₸`
              }
              contentStyle={{
                background: "#0f172a",
                border: "1px solid #334155",
                borderRadius: 12,
                color: "#fff",
              }}
            />

            <Legend />

            <Line
              type="monotone"
              dataKey="revenue"
              name="Доход"
              stroke="#22C55E"
              strokeWidth={3}
              dot={{ r: 4 }}
            />

            <Line
              type="monotone"
              dataKey="received"
              name="Получено"
              stroke="#3B82F6"
              strokeWidth={3}
              dot={{ r: 4 }}
            />

            <Line
              type="monotone"
              dataKey="profit"
              name="Прибыль"
              stroke="#A855F7"
              strokeWidth={3}
              dot={{ r: 4 }}
            />

            <Line
              type="monotone"
              dataKey="debt"
              name="Дебиторка"
              stroke="#F59E0B"
              strokeWidth={3}
              dot={{ r: 4 }}
            />

          </LineChart>

        </ResponsiveContainer>

      </div>

    </div>
  );
}
