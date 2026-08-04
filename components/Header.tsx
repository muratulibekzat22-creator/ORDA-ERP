"use client";

import { useEffect, useState } from "react";

import {
  Bell,
  Search,
  UserCircle,
  Plus,
  FileText,
  Clock3,
  Building2,
  ChevronDown,
  Settings,
  LogOut,
} from "lucide-react";

export default function Header() {
  const [time, setTime] = useState("");

  useEffect(() => {
    const update = () => {
      setTime(
        new Date().toLocaleString("ru-RU", {
          dateStyle: "short",
          timeStyle: "short",
        })
      );
    };

    update();

    const interval = setInterval(update, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <header className="sticky top-0 z-50 flex h-18 items-center justify-between border-b border-slate-800 bg-[#0f172a]/95 px-6 backdrop-blur">

      <div className="flex items-center gap-6">

        <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2">

          <Building2
            size={22}
            className="text-yellow-400"
          />

          <div>

            <p className="text-xs text-slate-400">
              Организация
            </p>

            <div className="flex items-center gap-1">

              <span className="font-semibold text-white">
                ALTYN SAPA COMPANY
              </span>

              <ChevronDown
                size={15}
                className="text-slate-400"
              />

            </div>

          </div>

        </div>

        <div className="relative">

          <Search
            size={18}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />

          <input
            type="text"
            placeholder="Поиск клиентов, заказов, партнеров..."
            className="w-[430px] rounded-2xl border border-slate-700 bg-slate-900 py-3 pl-11 pr-4 text-white outline-none transition focus:border-blue-500"
          />

        </div>

      </div>

      <div className="flex items-center gap-3">

        <button className="flex items-center gap-2 rounded-xl bg-green-600 px-4 py-2 font-medium text-white transition hover:bg-green-700">

          <Plus size={18} />

          Новый заказ

        </button>

        <button className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 font-medium text-white transition hover:bg-blue-700">

          <FileText size={18} />

          Создать КП

        </button>

        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2">

          <Clock3
            size={18}
            className="text-slate-400"
          />

          <span className="text-sm text-slate-300">
            {time}
          </span>

        </div>

        <button className="relative rounded-xl border border-slate-700 bg-slate-900 p-3 transition hover:bg-slate-800">

          <Bell size={20} />

          <span className="absolute right-2 top-2 flex h-2.5 w-2.5">

            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-70" />

            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />

          </span>

        </button>

        <button className="rounded-xl border border-slate-700 bg-slate-900 p-3 transition hover:bg-slate-800">

          <Settings size={20} />

        </button>

        <div className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-2">

          <UserCircle
            size={42}
            className="text-blue-400"
          />

          <div>

            <p className="font-semibold text-white">
              Бекзат
            </p>

            <p className="text-xs text-slate-400">
              Director
            </p>

          </div>

          <ChevronDown
            size={16}
            className="text-slate-500"
          />

        </div>

        <button className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-400 transition hover:bg-red-500 hover:text-white">

          <LogOut size={20} />

        </button>

      </div>

    </header>
  );
}