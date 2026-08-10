"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

interface Props {
  orderId: number;
}

export default function ProjectPayments({ orderId }: Props) {
  const router = useRouter();
  const { getKey, reset } = useIdempotencyKey();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    amount: "",
    type: "Предоплата",
    method: "Kaspi перевод",
    comment: "",
  });

  async function savePayment() {
    const amount = Number(form.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Укажите сумму оплаты больше нуля.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getKey(),
        },
        body: JSON.stringify({
          orderId,
          amount,
          type: form.type,
          method: form.method,
          comment: form.comment,
        }),
      });

      if (!res.ok) {
        const data: { error?: string } = await res.json();

        throw new Error(data.error ?? "Не удалось добавить оплату");
      }

      setForm({
        amount: "",
        type: "Предоплата",
        method: "Kaspi перевод",
        comment: "",
      });
      reset();

      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось добавить оплату");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-slate-700 bg-[#101827] p-6">

      <h2 className="text-xl font-bold text-white">
        Оплата
      </h2>

      <input
        type="number"
        min="0"
        step="0.01"
        className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
        placeholder="Сумма"
        value={form.amount}
        onChange={(e) =>
          setForm({ ...form, amount: e.target.value })
        }
      />

      <select
        className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
        value={form.type}
        onChange={(e) =>
          setForm({ ...form, type: e.target.value })
        }
      >
        <option>Предоплата</option>
        <option>Доплата</option>
      </select>

      <select
        className="w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
        value={form.method}
        onChange={(e) =>
          setForm({ ...form, method: e.target.value })
        }
      >
        <option>Наличные</option>
        <option>Kaspi перевод</option>
        <option>Kaspi рассрочка</option>
        <option>Банковский перевод</option>
        <option>Банковская карта</option>
        <option>Другое</option>
      </select>

      <textarea
        className="h-28 w-full rounded-xl bg-slate-900 p-3 text-white outline-none ring-1 ring-slate-700 focus:ring-blue-500"
        placeholder="Комментарий"
        value={form.comment}
        onChange={(e) =>
          setForm({ ...form, comment: e.target.value })
        }
      />

      {error && <p className="text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={savePayment}
        disabled={loading}
        className="rounded-xl bg-green-600 px-6 py-3 text-white transition hover:bg-green-700 disabled:cursor-wait disabled:opacity-70"
      >
        {loading ? "Сохранение..." : "Добавить оплату"}
      </button>

    </div>
  );
}
