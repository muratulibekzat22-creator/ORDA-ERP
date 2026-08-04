"use client";

import { useCallback, useEffect, useState } from "react";

export default function StairCalculator() {
  const [steps, setSteps] = useState(20);
  const [platforms, setPlatforms] = useState(1);

  const [material, setMaterial] = useState("Карагач");
  const [railing, setRailing] = useState("Нет");

  const [led, setLed] = useState(false);
  const [painting, setPainting] = useState(true);
  const [installation, setInstallation] = useState(true);

  const [delivery, setDelivery] = useState(0);

  const [salePrice, setSalePrice] = useState(0);
  const [costPrice, setCostPrice] = useState(0);
  const [profit, setProfit] = useState(0);
  const [margin, setMargin] = useState(0);

  const calculate = useCallback(() => {
    let stepPrice = 85000;
    let costStep = 50000;

    switch (material) {
      case "Сосна":
        stepPrice = 65000;
        costStep = 40000;
        break;

      case "Карагач":
        stepPrice = 85000;
        costStep = 55000;
        break;

      case "Дуб":
        stepPrice = 110000;
        costStep = 70000;
        break;
    }

    const totalSteps = steps + platforms * 3;

    let sale = totalSteps * stepPrice;
    let cost = totalSteps * costStep;

    switch (railing) {
      case "Дерево":
        sale += 650000;
        cost += 420000;
        break;

      case "Стекло":
        sale += 900000;
        cost += 650000;
        break;

      case "Латунь":
        sale += 1800000;
        cost += 1450000;
        break;
    }

    if (led) {
      sale += 250000;
      cost += 170000;
    }

    if (painting) {
      sale += 300000;
      cost += 180000;
    }

    if (installation) {
      sale += 350000;
      cost += 250000;
    }

    sale += delivery;
    cost += delivery;

    const p = sale - cost;

    setSalePrice(sale);
    setCostPrice(cost);
    setProfit(p);
    setMargin(
      sale > 0
        ? Number(((p / sale) * 100).toFixed(1))
        : 0
    );
  }, [steps, platforms, material, railing, led, painting, installation, delivery]);

  useEffect(() => {
    const timer = window.setTimeout(calculate, 0);
    return () => window.clearTimeout(timer);
  }, [calculate]);

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-2 gap-5">

        <input
          type="number"
          value={steps}
          onChange={(e) => setSteps(Number(e.target.value))}
          placeholder="Количество ступеней"
          className="rounded-xl bg-slate-900 p-3 text-white"
        />

        <input
          type="number"
          value={platforms}
          onChange={(e) => setPlatforms(Number(e.target.value))}
          placeholder="Количество площадок"
          className="rounded-xl bg-slate-900 p-3 text-white"
        />

        <select
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        >
          <option>Сосна</option>
          <option>Карагач</option>
          <option>Дуб</option>
        </select>

        <select
          value={railing}
          onChange={(e) => setRailing(e.target.value)}
          className="rounded-xl bg-slate-900 p-3 text-white"
        >
          <option>Нет</option>
          <option>Дерево</option>
          <option>Стекло</option>
          <option>Латунь</option>
        </select>

        <input
          type="number"
          value={delivery}
          onChange={(e) => setDelivery(Number(e.target.value))}
          placeholder="Доставка"
          className="rounded-xl bg-slate-900 p-3 text-white"
        />

      </div>

      <div className="flex gap-8">

        <label className="flex items-center gap-2 text-white">
          <input
            type="checkbox"
            checked={led}
            onChange={(e) => setLed(e.target.checked)}
          />
          LED
        </label>

        <label className="flex items-center gap-2 text-white">
          <input
            type="checkbox"
            checked={painting}
            onChange={(e) => setPainting(e.target.checked)}
          />
          Покраска
        </label>

        <label className="flex items-center gap-2 text-white">
          <input
            type="checkbox"
            checked={installation}
            onChange={(e) => setInstallation(e.target.checked)}
          />
          Монтаж
        </label>

      </div>

      <div className="grid grid-cols-4 gap-6">

        <div className="rounded-xl bg-[#101827] p-6">
          <p className="text-slate-400">Продажа</p>
          <h2 className="mt-3 text-3xl font-bold text-green-400">
            {salePrice.toLocaleString()} ₸
          </h2>
        </div>

        <div className="rounded-xl bg-[#101827] p-6">
          <p className="text-slate-400">Себестоимость</p>
          <h2 className="mt-3 text-3xl font-bold text-orange-400">
            {costPrice.toLocaleString()} ₸
          </h2>
        </div>

        <div className="rounded-xl bg-[#101827] p-6">
          <p className="text-slate-400">Прибыль</p>
          <h2 className="mt-3 text-3xl font-bold text-blue-400">
            {profit.toLocaleString()} ₸
          </h2>
        </div>

        <div className="rounded-xl bg-[#101827] p-6">
          <p className="text-slate-400">Маржа</p>
          <h2 className="mt-3 text-3xl font-bold text-yellow-400">
            {margin}%
          </h2>
        </div>

      </div>

    </div>
  );
}
