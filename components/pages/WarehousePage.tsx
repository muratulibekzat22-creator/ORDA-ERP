"use client";

import {
  Package,
  Plus,
  AlertTriangle,
  Boxes,
} from "lucide-react";

const materials = [
  {
    id: 1,
    name: "Дуб",
    unit: "м²",
    stock: 128,
    min: 40,
    supplier: "Wood Kazakhstan",
  },
  {
    id: 2,
    name: "Карагач",
    unit: "м²",
    stock: 54,
    min: 30,
    supplier: "Almaty Wood",
  },
  {
    id: 3,
    name: "Сосна",
    unit: "м²",
    stock: 240,
    min: 80,
    supplier: "Timber Group",
  },
  {
    id: 4,
    name: "Лак",
    unit: "л",
    stock: 22,
    min: 15,
    supplier: "Sayerlack",
  },
  {
    id: 5,
    name: "LED подсветка",
    unit: "шт",
    stock: 48,
    min: 20,
    supplier: "LED Pro",
  },
];

export default function WarehousePage() {
  return (
    <section className="flex-1 overflow-auto p-8">

      <div className="mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Склад
          </h1>

          <p className="mt-2 text-slate-400">
            Материалы, остатки и закупки
          </p>

        </div>

        <button className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">

          <Plus size={18} />

          Добавить материал

        </button>

      </div>

      <div className="mb-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Package className="mb-4 text-blue-400" />

          <p className="text-slate-400">
            Материалов
          </p>

          <h2 className="mt-2 text-4xl font-bold text-white">
            {materials.length}
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Boxes className="mb-4 text-green-400" />

          <p className="text-slate-400">
            Всего остатков
          </p>

          <h2 className="mt-2 text-4xl font-bold text-green-400">
            492
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <AlertTriangle className="mb-4 text-yellow-400" />

          <p className="text-slate-400">
            Заканчиваются
          </p>

          <h2 className="mt-2 text-4xl font-bold text-yellow-400">
            1
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Package className="mb-4 text-purple-400" />

          <p className="text-slate-400">
            Поставщиков
          </p>

          <h2 className="mt-2 text-4xl font-bold text-purple-400">
            5
          </h2>

        </div>

      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">

        <table className="w-full">

          <thead className="bg-slate-900">

            <tr>

              <th className="px-6 py-4 text-left text-slate-400">
                Материал
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Остаток
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Минимум
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Поставщик
              </th>

              <th className="px-6 py-4 text-left text-slate-400">
                Статус
              </th>

            </tr>

          </thead>

          <tbody>

            {materials.map((item) => {

              const low = item.stock <= item.min;

              return (
                <tr
                  key={item.id}
                  className="border-t border-slate-800 hover:bg-slate-900"
                >

                  <td className="px-6 py-5 font-semibold text-white">
                    {item.name}
                  </td>

                  <td className="px-6 py-5 text-green-400">
                    {item.stock} {item.unit}
                  </td>

                  <td className="px-6 py-5 text-slate-300">
                    {item.min} {item.unit}
                  </td>

                  <td className="px-6 py-5 text-cyan-400">
                    {item.supplier}
                  </td>

                  <td className="px-6 py-5">

                    <span
                      className={`rounded-full px-3 py-1 text-sm ${
                        low
                          ? "bg-red-600 text-white"
                          : "bg-green-600 text-white"
                      }`}
                    >
                      {low ? "Закупить" : "В наличии"}
                    </span>

                  </td>

                </tr>
              );
            })}

          </tbody>

        </table>

      </div>

    </section>
  );
}