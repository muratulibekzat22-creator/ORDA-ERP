"use client";

import { useEffect, useState } from "react";

import ProductionTable from "@/components/production/ProductionTable";

export default function ProductionPage() {
  const [productions, setProductions] = useState([]);

  async function loadProductions() {
    const response = await fetch("/api/production");

    if (!response.ok) return;

    const data = await response.json();

    setProductions(data);
  }

  useEffect(() => {
    loadProductions();
  }, []);

  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-3xl font-bold text-white">
          Производство
        </h1>

        <p className="text-slate-400">
          Контроль выполнения заказов
        </p>

      </div>

      <div className="grid grid-cols-4 gap-5">

        <div className="rounded-2xl bg-[#101827] p-6 border border-slate-700">

          <p className="text-slate-400">
            Всего заказов
          </p>

          <h2 className="mt-3 text-4xl font-bold text-white">
            {productions.length}
          </h2>

        </div>

        <div className="rounded-2xl bg-[#101827] p-6 border border-slate-700">

          <p className="text-slate-400">
            В работе
          </p>

          <h2 className="mt-3 text-4xl font-bold text-yellow-400">
            {
              productions.filter(
                (item: any) => item.stage !== "Готово"
              ).length
            }
          </h2>

        </div>

        <div className="rounded-2xl bg-[#101827] p-6 border border-slate-700">

          <p className="text-slate-400">
            Завершено
          </p>

          <h2 className="mt-3 text-4xl font-bold text-green-400">
            {
              productions.filter(
                (item: any) => item.stage === "Готово"
              ).length
            }
          </h2>

        </div>

        <div className="rounded-2xl bg-[#101827] p-6 border border-slate-700">

          <p className="text-slate-400">
            Средняя готовность
          </p>

          <h2 className="mt-3 text-4xl font-bold text-blue-400">
            {productions.length
              ? Math.round(
                  productions.reduce(
                    (sum: number, item: any) =>
                      sum + item.percent,
                    0
                  ) / productions.length
                )
              : 0}
            %
          </h2>

        </div>

      </div>

      <ProductionTable
        productions={productions}
      />

    </section>
  );
}