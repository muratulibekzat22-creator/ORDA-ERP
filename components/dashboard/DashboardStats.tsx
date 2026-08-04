"use client";

import {
  Users,
  ClipboardList,
  Factory,
  Wallet,
  TrendingUp,
  Clock3,
  UserCheck,
  Landmark,
} from "lucide-react";

interface Props {
  totalClients: number;
  totalOrders: number;
  totalProduction: number;
  totalRevenue: number;
}

export default function DashboardStats({
  totalClients,
  totalOrders,
  totalProduction,
  totalRevenue,
}: Props) {
  const stats = [
    {
      title: "Клиенты",
      value: totalClients.toLocaleString(),
      color: "text-blue-400",
      bg: "bg-blue-500/10",
      icon: Users,
    },
    {
      title: "Активные заказы",
      value: totalOrders.toLocaleString(),
      color: "text-yellow-400",
      bg: "bg-yellow-500/10",
      icon: ClipboardList,
    },
    {
      title: "Производство",
      value: totalProduction.toLocaleString(),
      color: "text-purple-400",
      bg: "bg-purple-500/10",
      icon: Factory,
    },
    {
      title: "Общая выручка",
      value: `${totalRevenue.toLocaleString()} ₸`,
      color: "text-green-400",
      bg: "bg-green-500/10",
      icon: Wallet,
    },
    {
      title: "Чистая прибыль",
      value: `${Math.round(totalRevenue * 0.32).toLocaleString()} ₸`,
      color: "text-emerald-400",
      bg: "bg-emerald-500/10",
      icon: TrendingUp,
    },
    {
      title: "Дебиторка",
      value: `${Math.round(totalRevenue * 0.18).toLocaleString()} ₸`,
      color: "text-orange-400",
      bg: "bg-orange-500/10",
      icon: Clock3,
    },
    {
      title: "Партнеры",
      value: "12",
      color: "text-cyan-400",
      bg: "bg-cyan-500/10",
      icon: UserCheck,
    },
    {
      title: "Средний чек",
      value:
        totalOrders > 0
          ? `${Math.round(totalRevenue / totalOrders).toLocaleString()} ₸`
          : "0 ₸",
      color: "text-pink-400",
      bg: "bg-pink-500/10",
      icon: Landmark,
    },
  ];

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">

      {stats.map((item) => {
        const Icon = item.icon;

        return (
          <div
            key={item.title}
            className="rounded-2xl border border-slate-700 bg-[#101827] p-6 transition hover:border-blue-500"
          >

            <div className="flex items-center justify-between">

              <div>

                <p className="text-sm text-slate-400">
                  {item.title}
                </p>

                <h2 className={`mt-3 text-3xl font-bold ${item.color}`}>
                  {item.value}
                </h2>

              </div>

              <div
                className={`flex h-14 w-14 items-center justify-center rounded-2xl ${item.bg}`}
              >
                <Icon
                  size={28}
                  className={item.color}
                />
              </div>

            </div>

          </div>
        );
      })}

    </div>
  );
}