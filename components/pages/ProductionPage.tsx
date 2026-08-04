"use client";

import { Factory } from "lucide-react";

const jobs = [
  {
    order: "AS-001",
    client: "ТОО Астана Дом",
    partner: "Алматы Лестница",
    stage: "Замер",
    percent: 10,
    master: "Бекзат",
    deadline: "05.08.2026",
  },
  {
    order: "AS-002",
    client: "Restaurant Talgar",
    partner: "Talgar Wood",
    stage: "Проектирование",
    percent: 20,
    master: "Ержан",
    deadline: "06.08.2026",
  },
  {
    order: "AS-003",
    client: "Villa House",
    partner: "Premium Stair",
    stage: "Заготовка",
    percent: 40,
    master: "Нурлан",
    deadline: "08.08.2026",
  },
  {
    order: "AS-004",
    client: "Premium House",
    partner: "Wood Expert",
    stage: "Покраска",
    percent: 60,
    master: "Азамат",
    deadline: "10.08.2026",
  },
  {
    order: "AS-005",
    client: "Residence Алматы",
    partner: "Altyn Sapa",
    stage: "Заказ готов",
    percent: 90,
    master: "Руслан",
    deadline: "12.08.2026",
  },
  {
    order: "AS-006",
    client: "Коттедж Каскелен",
    partner: "Altyn Sapa",
    stage: "Монтаж",
    percent: 95,
    master: "Данияр",
    deadline: "13.08.2026",
  },
  {
    order: "AS-007",
    client: "Villa Premium",
    partner: "Altyn Sapa",
    stage: "Сдано",
    percent: 100,
    master: "Бекзат",
    deadline: "03.08.2026",
  },
];

export default function ProductionPage() {
  return (
    <>
<div className="mb-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

<div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

  <p className="text-slate-400">
    Всего заказов
  </p>

  <h2 className="mt-3 text-4xl font-bold text-white">
    {jobs.length}
  </h2>

</div>

<div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

  <p className="text-slate-400">
    В работе
  </p>

  <h2 className="mt-3 text-4xl font-bold text-yellow-400">
    {
      jobs.filter(
        (x) =>
          x.stage !== "Сдано" &&
          x.stage !== "Заказ готов"
      ).length
    }
  </h2>

</div>

<div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

  <p className="text-slate-400">
    Готовы к монтажу
  </p>

  <h2 className="mt-3 text-4xl font-bold text-green-400">
    {
      jobs.filter(
        (x) => x.stage === "Заказ готов"
      ).length
    }
  </h2>

</div>

<div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

  <p className="text-slate-400">
    Сданы
  </p>

  <h2 className="mt-3 text-4xl font-bold text-cyan-400">
    {
      jobs.filter(
        (x) => x.stage === "Сдано"
      ).length
    }
  </h2>

</div>

</div>
<div className="mt-8 rounded-2xl border border-slate-700 bg-[#101827] p-6">

  <div className="mb-6 flex items-center gap-3">

    <Factory className="text-yellow-400" />

    <h2 className="text-2xl font-bold text-white">
      Очередь производства
    </h2>

  </div>

  <div className="grid gap-6 lg:grid-cols-4 2xl:grid-cols-8">

    {[
      "Новая заявка",
      "Замер",
      "Проектирование",
      "Заготовка",
      "Покраска",
      "Заказ готов",
      "Монтаж",
      "Сдано",
    ].map((stage) => (

      <div
        key={stage}
        className="rounded-xl bg-slate-900 p-4"
      >

        <div className="mb-4 flex items-center justify-between">

          <h3 className="font-bold text-white">
            {stage}
          </h3>

          <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">
            {
              jobs.filter((job) => job.stage === stage).length
            }
          </span>

        </div>

        {jobs
          .filter((job) => job.stage === stage)
          .map((job) => (

            <div
              key={job.order}
              className="mb-3 rounded-xl border border-slate-800 bg-[#0b1220] p-3 transition hover:border-blue-500"
            >

              <p className="font-bold text-white">
                {job.order}
              </p>

              <p className="mt-1 text-sm text-slate-400">
                {job.client}
              </p>

              <p className="mt-2 text-xs text-cyan-400">
                {job.partner}
              </p>

              <div className="mt-3 h-2 rounded-full bg-slate-800">

                <div
                  className="h-2 rounded-full bg-green-500"
                  style={{
                    width: `${job.percent}%`,
                  }}
                />

              </div>

              <div className="mt-2 flex justify-between text-xs">

                <span className="text-slate-500">
                  {job.master}
                </span>

                <span className="font-semibold text-green-400">
                  {job.percent}%
                </span>

              </div>

            </div>

          ))}

        {jobs.filter((job) => job.stage === stage).length === 0 && (

          <div className="rounded-xl border border-dashed border-slate-700 py-6 text-center text-sm text-slate-500">
            Нет заказов
          </div>

        )}

      </div>

    ))}

  </div>

</div>

    </>
  );
}
