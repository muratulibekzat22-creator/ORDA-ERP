"use client";

export default function SettingsPage() {
  return (
    <section className="space-y-8 p-8">

      <div>
        <h1 className="text-3xl font-bold text-white">
          Настройки ORDA
        </h1>

        <p className="mt-2 text-slate-400">
          Основные настройки компании ALTYN SAPA
        </p>
      </div>

      <div className="grid grid-cols-3 gap-5">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
          <h2 className="mb-5 text-xl font-bold text-white">
            Стоимость материалов
          </h2>

          <div className="space-y-4">

            <input
              defaultValue={65000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Сосна"
            />

            <input
              defaultValue={85000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Карагач"
            />

            <input
              defaultValue={110000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Дуб"
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-5 text-xl font-bold text-white">
            Ограждения
          </h2>

          <div className="space-y-4">

            <input
              defaultValue={650000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Дерево"
            />

            <input
              defaultValue={900000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Стекло"
            />

            <input
              defaultValue={1800000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Латунь"
            />

          </div>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <h2 className="mb-5 text-xl font-bold text-white">
            Дополнительно
          </h2>

          <div className="space-y-4">

            <input
              defaultValue={250000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="LED"
            />

            <input
              defaultValue={300000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Покраска"
            />

            <input
              defaultValue={350000}
              className="w-full rounded-xl bg-slate-900 p-3 text-white"
              placeholder="Монтаж"
            />

          </div>

        </div>

      </div>

      <div className="flex justify-end">

        <button className="rounded-xl bg-blue-600 px-8 py-3 text-lg font-semibold text-white hover:bg-blue-700">
          Сохранить настройки
        </button>

      </div>

    </section>
  );
}