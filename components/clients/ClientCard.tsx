"use client";

import Link from "next/link";
import { Client } from "@/lib/types";

interface Props {
  client: Client;
}

export default function ClientCard({ client }: Props) {
  return (
    <div className="space-y-6">

      <div className="rounded-2xl border border-slate-700 bg-[#101827] p-8">

        <div className="flex items-center gap-5">

          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-3xl font-bold text-white">
            {client.name.charAt(0).toUpperCase()}
          </div>

          <div>
            <h1 className="text-3xl font-bold text-white">
              {client.name}
            </h1>

            <p className="text-slate-400">
              Карточка клиента ORDA ERP
            </p>
          </div>

        </div>

      </div>

      <div className="grid grid-cols-2 gap-5">

        <div className="rounded-xl border border-slate-700 bg-[#101827] p-5">
          <p className="text-slate-400">Телефон</p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {client.phone}
          </h2>
        </div>

        <div className="rounded-xl border border-slate-700 bg-[#101827] p-5">
          <p className="text-slate-400">Город</p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {client.city}
          </h2>
        </div>

        <div className="rounded-xl border border-slate-700 bg-[#101827] p-5">
          <p className="text-slate-400">Менеджер</p>
          <h2 className="mt-2 text-xl font-semibold text-white">
            {client.manager}
          </h2>
        </div>

        <div className="rounded-xl border border-slate-700 bg-[#101827] p-5">
          <p className="text-slate-400">Стоимость</p>
          <h2 className="mt-2 text-xl font-semibold text-green-400">
            {client.amount} ₸
          </h2>
        </div>

      </div>

      <div className="grid grid-cols-4 gap-4">

        <Link
          href="#"
          className="rounded-xl bg-blue-600 p-5 text-center font-semibold text-white hover:bg-blue-700"
        >
          📐 Замер
        </Link>

        <Link
          href="#"
          className="rounded-xl bg-green-600 p-5 text-center font-semibold text-white hover:bg-green-700"
        >
          💰 Расчет
        </Link>

        <Link
          href="#"
          className="rounded-xl bg-yellow-500 p-5 text-center font-semibold text-black hover:bg-yellow-400"
        >
          📄 КП
        </Link>

        <Link
          href="#"
          className="rounded-xl bg-purple-600 p-5 text-center font-semibold text-white hover:bg-purple-700"
        >
          🏭 Производство
        </Link>

      </div>

    </div>
  );
}