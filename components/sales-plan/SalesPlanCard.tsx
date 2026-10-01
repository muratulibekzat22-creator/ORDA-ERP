"use client";

import { Target, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

type PlanCardPayload = {
  actual: {
    revenue: number;
    orders: number;
    progressPercent: number;
    gap: number;
    projectedRevenue: number;
    marginCoveragePercent: number;
    grossMarginPercent: number;
    bonusEligible: boolean;
    bonusBlockers: string[];
    nextTier: { label: string; remainingRevenue: number; rewardAmount: number } | null;
  };
  plan: {
    revenueTarget: number;
    orderTarget: number;
    minimumMarginPercent: number;
    requiredCostCoveragePercent: number;
  };
};

const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;

export default function SalesPlanCard({ month }: { month: string }) {
  const [data, setData] = useState<PlanCardPayload | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/sales-plan?month=${encodeURIComponent(month)}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("План временно недоступен");
        return response.json() as Promise<PlanCardPayload>;
      })
      .then(setData)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError("План временно недоступен");
      });
    return () => controller.abort();
  }, [month]);
  if (error)
    return <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">{error}</p>;
  if (!data)
    return <div className="h-40 animate-pulse rounded-2xl border border-slate-800 bg-[#101827]" />;
  const width = Math.min(Math.max(data.actual.progressPercent, 0), 100);
  return (
    <section className="overflow-hidden rounded-2xl border border-blue-500/25 bg-gradient-to-br from-blue-500/10 via-[#101827] to-[#101827] p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-blue-200"><Target size={20}/><h2 className="text-xl font-bold text-white">Командный план продаж</h2></div>
          <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
            <div><p className="text-sm text-slate-400">Факт / план</p><p className="mt-1 text-2xl font-bold text-white">{money(data.actual.revenue)} <span className="text-base font-medium text-slate-500">из {money(data.plan.revenueTarget)}</span></p></div>
            <div><p className="text-sm text-slate-400">Выполнение</p><p className="mt-1 text-2xl font-bold text-blue-200">{data.actual.progressPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</p></div>
            <div><p className="text-sm text-slate-400">Заказы</p><p className="mt-1 text-xl font-bold text-white">{data.actual.orders} / {data.plan.orderTarget}</p></div>
            <div><p className="text-sm text-slate-400">Прогноз</p><p className="mt-1 text-xl font-bold text-white">{money(data.actual.projectedRevenue)}</p></div>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${width}%` }}/></div>
          <p className="mt-3 text-sm text-slate-400">
            До плана {money(data.actual.gap)} · цены производства заполнены на {data.actual.marginCoveragePercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% заказов.
            {data.actual.nextTier ? ` До уровня «${data.actual.nextTier.label}» команде осталось ${money(data.actual.nextTier.remainingRevenue)}.` : ""}
          </p>
          <p className={`mt-2 text-sm ${data.actual.bonusEligible ? "text-emerald-300" : "text-amber-200"}`}>
            Командный бонус: общий план + цена производства {data.plan.requiredCostCoveragePercent}% + валовая маржа не ниже {data.plan.minimumMarginPercent}%.
            Сейчас цена заполнена на {data.actual.marginCoveragePercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%, маржа {data.actual.grossMarginPercent.toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%.
          </p>
        </div>
        <Link href={`/sales-plan?month=${encodeURIComponent(month)}`} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white hover:bg-blue-500"><TrendingUp size={18}/>Открыть план</Link>
      </div>
    </section>
  );
}
