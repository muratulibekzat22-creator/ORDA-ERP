"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

interface OrderOption {
  id: number;
  number: string;
  partnerBalance: string | number;
}

export default function PartnerPaymentForm({ orders }: { orders: OrderOption[] }) {
  const router = useRouter();
  const { getKey, reset } = useIdempotencyKey();
  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("Наличные");
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const selectedOrder = orders.find((order) => order.id === Number(orderId));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(amount);
    const available = Number(selectedOrder?.partnerBalance ?? 0);
    if (!selectedOrder || !Number.isFinite(value) || value <= 0) { setError("Выберите заказ и укажите положительную сумму."); return; }
    if (value > available) { setError("Сумма выплаты не может быть больше задолженности по заказу."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/partners/payments", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": getKey() }, body: JSON.stringify({ orderId: selectedOrder.id, amount: value, method, comment }) });
      const payload: { error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить выплату.");
      setAmount(""); setComment(""); reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить выплату."); }
    finally { setSaving(false); }
  }

  return <form onSubmit={submit} className="space-y-4 rounded-2xl border border-slate-700 bg-[#101827] p-6"><h2 className="text-xl font-bold text-white">Выплата партнёру</h2>{orders.length === 0 ? <p className="text-slate-400">Для выплаты нужен заказ, назначенный этому партнёру.</p> : <><select required value={orderId} onChange={(event) => setOrderId(event.target.value)} className="w-full rounded-xl bg-slate-900 p-3 text-white"><option value="">Выберите заказ</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.number} — долг {Number(order.partnerBalance).toLocaleString()} ₸</option>)}</select><input required type="number" min="0.01" step="0.01" max={selectedOrder ? Number(selectedOrder.partnerBalance) : undefined} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Сумма выплаты" className="w-full rounded-xl bg-slate-900 p-3 text-white"/><select value={method} onChange={(event) => setMethod(event.target.value)} className="w-full rounded-xl bg-slate-900 p-3 text-white"><option>Наличные</option><option>Kaspi</option><option>Банковский перевод</option></select><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий" className="min-h-24 w-full rounded-xl bg-slate-900 p-3 text-white"/>{error && <p role="alert" className="text-sm text-red-400">{error}</p>}<button disabled={saving} className="rounded-xl bg-green-600 px-5 py-3 text-white disabled:opacity-50">{saving ? "Сохранение..." : "Добавить выплату"}</button></>}</form>;
}
