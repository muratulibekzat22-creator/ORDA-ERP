"use client";

import StairCalculator from "@/components/calculator/StairCalculator";

export default function CalculatorPage() {
  return (
    <section className="space-y-8 p-4 md:p-8">
      <div>
        <h1 className="text-4xl font-bold text-white">Калькулятор лестницы</h1>

        <p className="mt-2 text-slate-400">
          Расчет стоимости заказа ALTYN SAPA
        </p>
      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4 md:p-8">
        <StairCalculator />
      </div>
    </section>
  );
}
