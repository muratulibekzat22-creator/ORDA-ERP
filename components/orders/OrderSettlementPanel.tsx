"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";
import type { OrderTabData } from "./tabs/types";

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const statuses: Record<string, string> = { NOT_ASSIGNED: "Не назначен", UNPAID: "Не оплачено", PARTIAL: "Частично", PAID: "Оплачено", OVERPAID: "Переплата" };
const today = () => new Date().toISOString().slice(0, 10);

export default function OrderSettlementPanel({ order }: { order: Pick<OrderTabData, "id" | "partner" | "settlement"> }) {
  const router = useRouter();
  const { data: session } = useSession();
  const role = session?.user.role ?? "";
  const [partners, setPartners] = useState<Array<{ id: number; name: string; active: boolean }>>([]);
  const [partnerId, setPartnerId] = useState(String(order.partner?.id ?? ""));
  const [agreed, setAgreed] = useState(String(order.settlement?.partner?.agreed ?? ""));
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [operationDate, setOperationDate] = useState(today());
  const [method, setMethod] = useState("bank_transfer");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (role !== "DIRECTOR") return;
    void fetch("/api/partners").then((response) => response.ok ? response.json() : []).then((data: unknown) => setPartners(Array.isArray(data) ? data.filter((item): item is { id: number; name: string; active: boolean } => Boolean(item) && typeof item === "object" && "id" in item && "name" in item && (!("active" in item) || item.active === true)) : []));
  }, [role]);

  async function request(url: string, payload: Record<string, unknown>, method = "POST") {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Операция не выполнена");
      setAmount(""); setComment(""); setReason(""); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Операция не выполнена"); }
    finally { setBusy(false); }
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    await request(`/api/orders/${order.id}`, { action: "assignPartner", partnerId: Number(partnerId), partnerPrice: Number(agreed), reason, directorConfirmed: Boolean(order.partner && order.partner.id !== Number(partnerId)) }, "PATCH");
  }
  async function payout(event: FormEvent) {
    event.preventDefault();
    await request("/api/partners/payments", { orderId: order.id, amount: Number(amount), operationDate, method, comment });
  }

  const client = order.settlement?.client, partner = order.settlement?.partner;
  if (!client && !partner) return null;
  return <section id="settlements" className="scroll-mt-24 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-5">
    <h2 className="text-lg font-semibold text-white">Финансы заказа</h2>
    <p className="mt-1 text-sm text-slate-400">Оплаты клиента и расчёты с цехом ведутся независимо.</p>
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {client && <div className="min-w-0 rounded-xl border border-slate-700 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-white">Клиент</h3><span className="text-sm text-blue-300">{statuses[client.status] ?? client.status}</span></div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Сумма заказа</dt><dd className="font-semibold text-white">{money(client.total)}</dd></div><div><dt className="text-slate-500">Получено</dt><dd className="font-semibold text-emerald-300">{money(client.received)}</dd></div><div><dt className="text-slate-500">Остаток</dt><dd className="font-semibold text-amber-300">{money(client.remaining)}</dd></div>{client.overpayment > 0 && <div><dt className="text-slate-500">Переплата</dt><dd className="font-semibold text-violet-300">{money(client.overpayment)}</dd></div>}</dl>
      </div>}
      {partner && <div className="min-w-0 rounded-xl border border-slate-700 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-white">Цех / партнёр</h3><span className="text-sm text-blue-300">{statuses[partner.status] ?? partner.status}</span></div>
        <p className="mt-1 break-words text-sm text-slate-300">{partner.partnerName ?? "Не назначен"}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Цена партнёра</dt><dd className="font-semibold text-white">{partner.priceSet && partner.agreed !== null ? money(partner.agreed) : "Цена партнёра не указана"}</dd></div><div><dt className="text-slate-500">Выплачено партнёру</dt><dd className="font-semibold text-emerald-300">{money(partner.paid)}</dd></div><div><dt className="text-slate-500">Осталось выплатить</dt><dd className="font-semibold text-amber-300">{money(partner.remaining)}</dd></div>{role === "DIRECTOR" && <div><dt className="text-slate-500">Валовая маржа</dt><dd className="font-semibold text-cyan-300">{partner.priceSet && partner.agreed !== null && client ? money(client.total - partner.agreed) : "—"}</dd></div>}{partner.overpayment > 0 && <div><dt className="text-slate-500">Переплата</dt><dd className="font-semibold text-violet-300">{money(partner.overpayment)}</dd></div>}</dl>
      </div>}
    </div>
    {role === "DIRECTOR" && <form onSubmit={assign} className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2">
      <h3 className="sm:col-span-2 font-semibold text-white">Назначить цех и согласовать сумму</h3>
      <select required value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"><option value="">Выберите цех</option>{partners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <input required type="number" min="0" step="0.01" value={agreed} onChange={(event) => setAgreed(event.target.value)} placeholder="Согласованная сумма" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
      <input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Причина / комментарий" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white sm:col-span-2" />
      <button disabled={busy} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2">Сохранить условия</button>
    </form>}
    {partner?.partnerId && partner.priceSet && ["DIRECTOR", "ACCOUNTANT"].includes(role) && <form onSubmit={payout} className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2">
      <h3 className="sm:col-span-2 font-semibold text-white">Выплатить партнёру</h3>
      <input required type="number" min="0.01" step="0.01" max={partner.remaining} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Сумма выплаты" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
      <input required type="date" value={operationDate} onChange={(event) => setOperationDate(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
      <select value={method} onChange={(event) => setMethod(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"><option value="cash">Наличные</option><option value="kaspi">Kaspi</option><option value="bank_transfer">Банковский перевод</option><option value="other">Другое</option></select>
      <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" />
      <button disabled={busy || Number(amount) <= 0 || Number(amount) > partner.remaining} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2">Провести выплату</button>
    </form>}
    {partner && partner.payouts.length > 0 && <div className="mt-4"><h3 className="font-semibold text-white">История выплат</h3><ul className="mt-2 space-y-2 text-sm">{partner.payouts.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-950/50 p-3 text-slate-300"><span>{item.type === "PARTNER_PAYOUT_REVERSAL" ? "Сторно" : "Выплата"} · {item.method}</span><strong className="text-white">{money(item.amount)}</strong></li>)}</ul></div>}
  </section>;
}
