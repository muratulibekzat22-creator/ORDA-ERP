"use client";

import { useState } from "react";

interface Props {
  orderId: number;
}

export default function ProjectPayments({ orderId }: Props) {
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    amount: "",
    type: "Предоплата",
    method: "Kaspi",
    comment: "",
  });

  async function savePayment() {
    setLoading(true);

    const res = await fetch("/api/payments", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        orderId,
        amount: Number(form.amount),
        type: form.type,
        method: form.method,
        comment: form.comment,
      }),
    });

    if (res.ok) {
      alert("Платеж успешно добавлен.");

      setForm({
        amount: "",
        type: "Предоплата",
        method: "Kaspi",
        comment: "",
      });
    } else {
      alert("Ошибка при добавлении платежа.");
    }

    setLoading(false);
  }

  return (
    <div className="bg-white rounded-xl shadow p-6 space-y-4">

      <h2 className="text-xl font-bold">
        Платежи
      </h2>

      <input
        type="number"
        className="border rounded-lg p-3 w-full"
        placeholder="Сумма"
        value={form.amount}
        onChange={(e) =>
          setForm({ ...form, amount: e.target.value })
        }
      />

      <select
        className="border rounded-lg p-3 w-full"
        value={form.type}
        onChange={(e) =>
          setForm({ ...form, type: e.target.value })
        }
      >
        <option>Предоплата</option>
        <option>Вторая оплата</option>
        <option>Финальный платеж</option>
      </select>

      <select
        className="border rounded-lg p-3 w-full"
        value={form.method}
        onChange={(e) =>
          setForm({ ...form, method: e.target.value })
        }
      >
        <option>Kaspi</option>
        <option>Наличные</option>
        <option>Банковский перевод</option>
      </select>

      <textarea
        className="border rounded-lg p-3 w-full h-28"
        placeholder="Комментарий"
        value={form.comment}
        onChange={(e) =>
          setForm({ ...form, comment: e.target.value })
        }
      />

      <button
        onClick={savePayment}
        disabled={loading}
        className="bg-green-600 hover:bg-green-700 text-white rounded-lg px-6 py-3"
      >
        {loading ? "Сохранение..." : "Добавить платеж"}
      </button>

    </div>
  );
}