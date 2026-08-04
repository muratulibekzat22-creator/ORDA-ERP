"use client";

import {
  CalendarDays,
  Plus,
  Clock3,
  Ruler,
  Hammer,
  Factory,
  Users,
} from "lucide-react";

const events = [
  {
    id: 1,
    date: "05.08.2026",
    time: "10:00",
    title: "Замер",
    client: "ТОО Астана Дом",
    manager: "Бекзат",
    color: "bg-blue-600",
    icon: Ruler,
  },
  {
    id: 2,
    date: "05.08.2026",
    time: "14:00",
    title: "Производство",
    client: "Villa House",
    manager: "Ержан",
    color: "bg-purple-600",
    icon: Factory,
  },
  {
    id: 3,
    date: "06.08.2026",
    time: "09:00",
    title: "Монтаж",
    client: "Restaurant Talgar",
    manager: "Нурлан",
    color: "bg-green-600",
    icon: Hammer,
  },
  {
    id: 4,
    date: "06.08.2026",
    time: "16:30",
    title: "Встреча",
    client: "Premium House",
    manager: "Бекзат",
    color: "bg-orange-600",
    icon: Users,
  },
];

export default function CalendarPage() {
  return (
    <section className="flex-1 overflow-auto p-8">

      <div className="mb-8 flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Календарь
          </h1>

          <p className="mt-2 text-slate-400">
            Замеры, производство, монтажи и встречи
          </p>

        </div>

        <button className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">

          <Plus size={18} />

          Новое событие

        </button>

      </div>

      <div className="mb-8 grid gap-6 md:grid-cols-2 xl:grid-cols-4">

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <CalendarDays className="mb-4 text-blue-400" />

          <p className="text-slate-400">
            Событий сегодня
          </p>

          <h2 className="mt-2 text-4xl font-bold text-white">
            4
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Ruler className="mb-4 text-yellow-400" />

          <p className="text-slate-400">
            Замеры
          </p>

          <h2 className="mt-2 text-4xl font-bold text-yellow-400">
            1
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Factory className="mb-4 text-purple-400" />

          <p className="text-slate-400">
            Производство
          </p>

          <h2 className="mt-2 text-4xl font-bold text-purple-400">
            1
          </h2>

        </div>

        <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

          <Hammer className="mb-4 text-green-400" />

          <p className="text-slate-400">
            Монтаж
          </p>

          <h2 className="mt-2 text-4xl font-bold text-green-400">
            1
          </h2>

        </div>

      </div>

      <div className="rounded-2xl border border-slate-700 bg-[#101827]">

        <div className="border-b border-slate-700 p-6">

          <h2 className="text-2xl font-bold text-white">
            Расписание
          </h2>

        </div>

        <div className="divide-y divide-slate-800">

          {events.map((event) => {
            const Icon = event.icon;

            return (
              <div
                key={event.id}
                className="flex items-center justify-between p-6 hover:bg-slate-900"
              >

                <div className="flex items-center gap-5">

                  <div
                    className={`flex h-14 w-14 items-center justify-center rounded-2xl ${event.color}`}
                  >
                    <Icon size={24} />
                  </div>

                  <div>

                    <h3 className="text-lg font-semibold text-white">
                      {event.title}
                    </h3>

                    <p className="text-slate-400">
                      {event.client}
                    </p>

                  </div>

                </div>

                <div className="text-right">

                  <div className="flex items-center justify-end gap-2 text-slate-300">

                    <Clock3 size={16} />

                    {event.date} • {event.time}

                  </div>

                  <p className="mt-2 text-sm text-cyan-400">
                    Ответственный: {event.manager}
                  </p>

                </div>

              </div>
            );
          })}

        </div>

      </div>

    </section>
  );
}