"use client";

import { ClipboardList, Factory, Landmark, TrendingUp, Users, Wallet } from "lucide-react";

type Props = { totalClients: number; totalOrders: number; totalProduction: number; totalRevenue: number; totalProfit: number; totalDebt: number; totalPartnerBalance: number };
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default function DashboardStats({ totalClients, totalOrders, totalProduction, totalRevenue, totalProfit, totalDebt, totalPartnerBalance }: Props) {
  const stats = [
    { title: "Клиенты", value: totalClients.toLocaleString(), color: "text-blue-400", icon: Users },
    { title: "Активные заказы", value: totalOrders.toLocaleString(), color: "text-yellow-400", icon: ClipboardList },
    { title: "Производство", value: totalProduction.toLocaleString(), color: "text-purple-400", icon: Factory },
    { title: "Сумма заказов", value: money(totalRevenue), color: "text-green-400", icon: Wallet },
    { title: "Прибыль", value: money(totalProfit), color: "text-emerald-400", icon: TrendingUp },
    { title: "Дебиторка", value: money(totalDebt), color: "text-orange-400", icon: Landmark },
    { title: "Остаток выплаты цеху", value: money(totalPartnerBalance), color: "text-cyan-400", icon: Landmark },
  ];
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{stats.map((item) => { const Icon = item.icon; return <div key={item.title} className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><div className="flex items-center justify-between"><div><p className="text-sm text-slate-400">{item.title}</p><p className={`mt-2 text-2xl font-bold ${item.color}`}>{item.value}</p></div><Icon className={item.color} size={26} /></div></div>; })}</div>;
}
