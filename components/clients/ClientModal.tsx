"use client";

import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (client: {
    name: string;
    phone: string;
    city: string;
    manager: string;
    amount: string;
  }) => void;
}

const managers = [
  "Бекзат",
  "Менеджер 1",
  "Менеджер 2",
];

export default function ClientModal({
  open,
  onClose,
  onSave,
}: Props) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("+7");
  const [city, setCity] = useState("Алматы");
  const [manager, setManager] = useState(managers[0]);
  const [amount, setAmount] = useState("");

  if (!open) return null;

  function formatPhone(value: string) {
    return value.replace(/[^\d+]/g, "");
  }

  function save() {
    if (name.trim().length < 2) {
      alert("Введите имя клиента");
      return;
    }

    if (phone.replace(/\D/g, "").length < 11) {
      alert("Введите корректный номер телефона");
      return;
    }

    onSave({
      name: name.trim(),
      phone,
      city: city.trim(),
      manager,
      amount: amount || "0",
    });

    setName("");
    setPhone("+7");
    setCity("Алматы");
    setManager(managers[0]);
    setAmount("");

    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">

      <div className="w-full max-w-xl rounded-2xl border border-slate-700 bg-[#101827] p-8 shadow-2xl">

        <h2 className="mb-8 text-2xl font-bold text-white">
          Новый клиент
        </h2>

        <div className="space-y-5">

          <div>

            <label className="mb-2 block text-sm text-slate-400">
              ФИО клиента
            </label>

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Введите имя клиента"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
            />

          </div>

          <div>

            <label className="mb-2 block text-sm text-slate-400">
              Телефон
            </label>

            <input
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="+7 777 777 77 77"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
            />

          </div>

          <div className="grid grid-cols-2 gap-4">

            <div>

              <label className="mb-2 block text-sm text-slate-400">
                Город
              </label>

              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
              />

            </div>

            <div>

              <label className="mb-2 block text-sm text-slate-400">
                Менеджер
              </label>

              <select
                value={manager}
                onChange={(e) => setManager(e.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
              >
                {managers.map((item) => (
                  <option key={item}>
                    {item}
                  </option>
                ))}
              </select>

            </div>

          </div>

          <div>

            <label className="mb-2 block text-sm text-slate-400">
              Предварительная стоимость
            </label>

            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white outline-none focus:border-blue-500"
            />

          </div>

        </div>

        <div className="mt-8 flex justify-end gap-3">

          <button
            onClick={onClose}
            className="rounded-xl bg-slate-700 px-6 py-3 text-white transition hover:bg-slate-600"
          >
            Отмена
          </button>

          <button
            onClick={save}
            className="rounded-xl bg-blue-600 px-6 py-3 font-semibold text-white transition hover:bg-blue-700"
          >
            Создать клиента
          </button>

        </div>

      </div>

    </div>
  );
}