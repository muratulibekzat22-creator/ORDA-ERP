"use client";

import { Search, X } from "lucide-react";

type ClientSearchProps = {
  value: string;
  onChange: (value: string) => void;
};

export default function ClientSearch({
  value,
  onChange,
}: ClientSearchProps) {
  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4">

      <div className="relative">

        <Search
          size={20}
          className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"
        />

        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              onChange("");
            }
          }}
          placeholder="Поиск по ФИО, телефону или городу..."
          className="w-full rounded-xl border border-slate-700 bg-slate-900 py-3 pl-12 pr-12 text-white outline-none transition focus:border-blue-500"
        />

        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 transition hover:bg-slate-700 hover:text-white"
          >
            <X size={18} />
          </button>
        )}

      </div>

      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">

        <span>
          Поиск выполняется по имени, телефону и городу.
        </span>

        <span>
          Esc — очистить
        </span>

      </div>

    </div>
  );
}