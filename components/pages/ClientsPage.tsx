"use client";

import { useEffect, useMemo, useState } from "react";

import ClientSearch from "@/components/clients/ClientSearch";
import ClientTable from "@/components/clients/ClientTable";
import ClientModal from "@/components/clients/ClientModal";

import { Client } from "@/lib/types";

export default function ClientsPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [open, setOpen] = useState(false);

  async function loadClients() {
    try {
      const params = new URLSearchParams();

      if (search) {
        params.set("search", search);
      }

      if (status) {
        params.set("status", status);
      }

      params.set("page", String(page));
      params.set("limit", "20");

      const response = await fetch(`/api/clients?${params.toString()}`);

      if (!response.ok) {
        throw new Error("Ошибка загрузки клиентов");
      }

      const result = await response.json();

      setClients(result.data);
      setPages(result.pagination.pages);
    } catch (error) {
      console.error(error);
    }
  }

  useEffect(() => {
    loadClients();
  }, [search, status, page]);

  async function addClient(client: {
    name: string;
    phone: string;
    city: string;
    manager: string;
    amount: string;
  }) {
    const response = await fetch("/api/clients", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(client),
    });

    if (response.ok) {
      setOpen(false);
      loadClients();
    } else {
      const error = await response.json();
      alert(error.error);
    }
  }

  const statistics = useMemo(() => {
    return {
      total: clients.length,
      newClients: clients.filter((c) => c.status === "Новый").length,
      working: clients.filter((c) => c.status === "В работе").length,
      completed: clients.filter((c) => c.status === "Завершено").length,
    };
  }, [clients]);

  return (
    <section className="space-y-6 p-8">

      <div className="flex items-center justify-between">

        <div>

          <h1 className="text-3xl font-bold text-white">
            Клиенты
          </h1>

          <p className="mt-1 text-slate-400">
            CRM клиентов ALTYN SAPA
          </p>

        </div>

        <button
          onClick={() => setOpen(true)}
          className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"
        >
          + Новый клиент
        </button>

      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">

        <Stat
          title="Всего"
          value={statistics.total}
          color="text-white"
        />

        <Stat
          title="Новые"
          value={statistics.newClients}
          color="text-green-400"
        />

        <Stat
          title="В работе"
          value={statistics.working}
          color="text-yellow-400"
        />

        <Stat
          title="Завершено"
          value={statistics.completed}
          color="text-cyan-400"
        />

      </div>

      <div className="flex gap-4">

        <div className="flex-1">
          <ClientSearch
            value={search}
            onChange={(value) => {
              setPage(1);
              setSearch(value);
            }}
          />
        </div>

        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="rounded-xl border border-slate-700 bg-slate-900 px-4 text-white"
        >
          <option value="">Все статусы</option>
          <option value="Новый">Новый</option>
          <option value="В работе">В работе</option>
          <option value="Завершено">Завершено</option>
        </select>

      </div>

      <ClientTable
        clients={clients}
      />

      <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-[#101827] p-4">

        <button
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40"
        >
          ← Назад
        </button>

        <span className="text-slate-300">
          Страница {page} из {pages}
        </span>

        <button
          disabled={page >= pages}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40"
        >
          Далее →
        </button>

      </div>

      <ClientModal
        open={open}
        onClose={() => setOpen(false)}
        onSave={addClient}
      />

    </section>
  );
}

function Stat({
  title,
  value,
  color,
}: {
  title: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-[#101827] p-5">

      <p className="text-sm text-slate-400">
        {title}
      </p>

      <h2 className={`mt-2 text-3xl font-bold ${color}`}>
        {value}
      </h2>

    </div>
  );
}