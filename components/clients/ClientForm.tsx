"use client";

import { useState } from "react";

interface Props {
  onSave: (client: {
    name: string;
    phone: string;
    city: string;
    manager: string;
    amount: string;
  }) => void;
}

export default function ClientForm({ onSave }: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [manager, setManager] = useState("");
  const [amount, setAmount] = useState("");

  function submit() {
    if (!name || !phone) {
      alert("Заполните имя и телефон");
      return;
    }

    onSave({
      name,
      phone,
      city,
      manager,
      amount,
    });

    setName("");
    setPhone("");
    setCity("");
    setManager("");
    setAmount("");
  }

  return (
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <h2 className="mb-6 text-2xl font-bold text-white">
        Новая заявка
      </h2>

      <div className="grid grid-cols-2 gap-4">

        <input
          placeholder="Имя клиента"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none"
        />

        <input
          placeholder="Телефон"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none"
        />

        <input
          placeholder="Город"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none"
        />

        <input
          placeholder="Менеджер"
          value={manager}
          onChange={(e) => setManager(e.target.value)}
          className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none"
        />

        <input
          placeholder="Предварительная сумма"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="col-span-2 rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none"
        />

      </div>

      <button
        onClick={submit}
        className="mt-6 rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-700"
      >
        Сохранить клиента
      </button>

    </div>
  );
}