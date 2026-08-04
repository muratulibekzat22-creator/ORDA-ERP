"use client";

import StairCalculator from "@/components/calculator/StairCalculator";

export default function CalculatorPage() {
  return (
    <section className="space-y-8 p-8">

      <div>

        <h1 className="text-4xl font-bold text-white">
          Калькулятор лестницы
        </h1>

        <p className="mt-2 text-slate-400">
          Расчет стоимости заказа ALTYN SAPA
        </p>

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-8">

        <StairCalculator />

      </div>

      <div className="grid grid-cols-3 gap-6">

        <button
          className="rounded-xl bg-blue-600 py-4 text-lg font-semibold text-white hover:bg-blue-700"
        >
          💾 Сохранить расчет
        </button>

        <button
          className="rounded-xl bg-green-600 py-4 text-lg font-semibold text-white hover:bg-green-700"
        >
          📄 Создать КП
        </button>

        <button
          className="rounded-xl bg-yellow-500 py-4 text-lg font-semibold text-black hover:bg-yellow-400"
        >
          📦 Создать заказ
        </button>

      </div>

    </section>
  );
}