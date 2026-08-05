"use client";

import { useCallback, useEffect, useState } from "react";

import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

interface Client { id: number; name: string; }
interface Props { onSave: () => Promise<void> | void; }

export default function OrderForm({ onSave }: Props) {
  const { getKey, reset } = useIdempotencyKey();
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [address, setAddress] = useState("");
  const [staircase, setStaircase] = useState("Прямая");
  const [material, setMaterial] = useState("Карагач");
  const [steps, setSteps] = useState("20");
  const [platforms, setPlatforms] = useState("1");
  const [amount, setAmount] = useState("0");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadClients = useCallback(async () => {
    const response = await fetch("/api/clients");
    if (!response.ok) throw new Error("Не удалось загрузить клиентов");
    const result = await response.json() as { data?: Client[] };
    setClients(Array.isArray(result.data) ? result.data : []);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadClients().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить клиентов"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadClients]);

  async function save() {
    const parsedClientId = Number(clientId);
    const parsedSteps = Number(steps);
    const parsedPlatforms = Number(platforms);
    const parsedAmount = Number(amount);
    if (!Number.isInteger(parsedClientId) || parsedClientId <= 0) return setError("Выберите клиента");
    if (!address.trim() || !Number.isInteger(parsedSteps) || parsedSteps <= 0 || !Number.isInteger(parsedPlatforms) || parsedPlatforms < 0 || !Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return setError("Проверьте обязательные и числовые поля заказа");
    }

    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": getKey() },
        body: JSON.stringify({ clientId: parsedClientId, address: address.trim(), staircase, material, amount: parsedAmount, prepayment: 0, partnerPrice: 0, partnerPaid: 0, steps: parsedSteps, platforms: parsedPlatforms }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) return setError(result.error ?? "Не удалось создать заказ");
      reset();
      await onSave();
      setClientId("");
      setAddress("");
      setSteps("20");
      setPlatforms("1");
      setAmount("0");
    } catch {
      setError("Не удалось создать заказ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
      <h2 className="mb-6 text-2xl font-bold text-white">Новый заказ</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <select required value={clientId} onChange={(event) => setClientId(event.target.value)} className="rounded-xl bg-slate-900 p-3 text-white">
          <option value="">Выберите клиента</option>
          {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
        </select>
        <input required value={address} onChange={(event) => setAddress(event.target.value)} placeholder="Адрес объекта" className="rounded-xl bg-slate-900 p-3 text-white" />
        <input value={staircase} onChange={(event) => setStaircase(event.target.value)} placeholder="Тип лестницы" className="rounded-xl bg-slate-900 p-3 text-white" />
        <input value={material} onChange={(event) => setMaterial(event.target.value)} placeholder="Материал" className="rounded-xl bg-slate-900 p-3 text-white" />
        <input type="number" min="1" value={steps} onChange={(event) => setSteps(event.target.value)} placeholder="Ступени" className="rounded-xl bg-slate-900 p-3 text-white" />
        <input type="number" min="0" value={platforms} onChange={(event) => setPlatforms(event.target.value)} placeholder="Площадки" className="rounded-xl bg-slate-900 p-3 text-white" />
        <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Сумма заказа" className="rounded-xl bg-slate-900 p-3 text-white" />
      </div>
      {error && <p className="mt-4 text-sm text-red-400">{error}</p>}
      <button type="button" onClick={save} disabled={saving} className="mt-6 w-full rounded-xl bg-blue-600 py-3 text-lg font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60">
        {saving ? "Сохранение..." : "Создать заказ"}
      </button>
    </section>
  );
}
