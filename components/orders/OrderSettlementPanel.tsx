"use client";

import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";
import type { OrderTabData } from "./tabs/types";

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const statuses: Record<string, string> = { NOT_ASSIGNED: "Не назначен", UNPAID: "Не оплачено", PARTIAL: "Частично", PAID: "Оплачено", OVERPAID: "Переплата" };
const today = () => new Date().toISOString().slice(0, 10);
const date = (value: Date | string | null) => value
  && !Number.isNaN(new Date(value).getTime())
  ? new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium" }).format(new Date(value))
  : "Дата не указана";
const methodLabels: Record<string, string> = {
  cash: "Наличные",
  kaspi: "Kaspi",
  bank_transfer: "Банковский перевод",
  other: "Другое",
};

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
    <h2 className="text-lg font-semibold text-white">Расчёты</h2>
    <p className="mt-1 text-sm text-slate-400">Оплаты клиента и расчёты с цехом ведутся независимо по данным заказа и платежей.</p>
    {error && <p role="alert" className="mt-3 rounded-xl bg-red-950/50 p-3 text-sm text-red-300">{error}</p>}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      {client && <div className="min-w-0 rounded-xl border border-blue-900/70 bg-blue-950/15 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-white">Клиент</h3><span className="text-sm text-blue-300">{statuses[client.status] ?? client.status}</span></div>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Сумма заказа</dt><dd className="font-semibold text-white">{money(client.total)}</dd></div><div><dt className="text-slate-500">Получено от клиента</dt><dd className="font-semibold text-emerald-300">{money(client.received)}</dd></div><div><dt className="text-slate-500">Остаток клиента</dt><dd className="font-semibold text-amber-300">{money(client.remaining)}</dd></div>{client.overpayment > 0 && <div><dt className="text-slate-500">Переплата</dt><dd className="font-semibold text-violet-300">{money(client.overpayment)}</dd></div>}</dl>
      </div>}
      {partner && <div className="min-w-0 rounded-xl border border-amber-900/70 bg-amber-950/10 p-4">
        <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-white">Цех / партнёр</h3><span className="text-sm text-blue-300">{statuses[partner.status] ?? partner.status}</span></div>
        <p className="mt-1 break-words text-sm text-slate-300">{partner.partnerName ?? "Не назначен"}</p>
        <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Согласованная стоимость цеха</dt><dd className="font-semibold text-white">{partner.priceSet && partner.agreed !== null ? money(partner.agreed) : "Стоимость цеха не указана"}</dd></div><div><dt className="text-slate-500">Выплачено цеху</dt><dd className="font-semibold text-emerald-300">{money(partner.paid)}</dd></div><div><dt className="text-slate-500">Осталось выплатить</dt><dd className="font-semibold text-amber-300">{money(partner.remaining)}</dd></div>{role === "DIRECTOR" && <div><dt className="text-slate-500">Валовая маржа</dt><dd className="font-semibold text-cyan-300">{partner.priceSet && partner.agreed !== null && client ? money(client.total - partner.agreed) : "—"}</dd></div>}{partner.overpayment > 0 && <div><dt className="text-slate-500">Переплата</dt><dd className="font-semibold text-violet-300">{money(partner.overpayment)}</dd></div>}</dl>
      </div>}
    </div>
    {role === "DIRECTOR" && <form onSubmit={assign} className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2">
      <h3 className="sm:col-span-2 font-semibold text-white">Указать стоимость цеха</h3>
      <label className="grid gap-1 text-sm text-slate-300"><span>Партнёр / цех</span><select required value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"><option value="">Выберите цех</option>{partners.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label className="grid gap-1 text-sm text-slate-300"><span>Согласованная стоимость цеха</span><span className="relative"><input required type="number" min="0" step="0.01" value={agreed} onChange={(event) => setAgreed(event.target.value)} placeholder="0" className="min-h-11 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 pr-9 text-white" /><span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-500">₸</span></span></label>
      <label className="grid gap-1 text-sm text-slate-300 sm:col-span-2"><span>Комментарий к согласованию (необязательно)</span><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Например: согласовано с цехом" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
      <button disabled={busy} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2">Указать стоимость цеха</button>
    </form>}
    {partner?.partnerId && partner.priceSet && ["DIRECTOR", "ACCOUNTANT"].includes(role) && <form onSubmit={payout} className="mt-4 grid gap-3 rounded-xl bg-slate-950/50 p-4 sm:grid-cols-2">
      <h3 className="sm:col-span-2 font-semibold text-white">Выплатить цеху</h3>
      <label className="grid gap-1 text-sm text-slate-300"><span>Сумма выплаты</span><input required type="number" min="0.01" step="0.01" max={partner.remaining} value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0 ₸" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
      <label className="grid gap-1 text-sm text-slate-300"><span>Дата выплаты</span><input required type="date" value={operationDate} onChange={(event) => setOperationDate(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
      <label className="grid gap-1 text-sm text-slate-300"><span>Способ оплаты</span><select value={method} onChange={(event) => setMethod(event.target.value)} className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"><option value="cash">Наличные</option><option value="kaspi">Kaspi</option><option value="bank_transfer">Банковский перевод</option><option value="other">Другое</option></select></label>
      <label className="grid gap-1 text-sm text-slate-300"><span>Комментарий (необязательно)</span><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий" className="min-h-11 min-w-0 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
      <button disabled={busy || Number(amount) <= 0 || Number(amount) > partner.remaining} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50 sm:col-span-2">Выплатить цеху</button>
    </form>}
    {partner && partner.payouts.length > 0 && <div className="mt-4"><h3 className="font-semibold text-white">История выплат цеху</h3><ul className="mt-2 space-y-2 text-sm">{partner.payouts.map((item) => <li key={item.id} className="flex flex-col gap-2 rounded-lg bg-slate-950/50 p-3 text-slate-300 sm:flex-row sm:items-center sm:justify-between"><span><strong className="text-slate-100">{item.type === "PARTNER_PAYOUT_REVERSAL" ? "Возврат выплаты" : "Выплата"}</strong><span className="block text-xs text-slate-500">{date(item.operationDate)} · {(methodLabels[item.method] ?? item.method) || "Способ не указан"}{item.author ? ` · ${item.author}` : ""}{item.comment ? ` · ${item.comment}` : ""}</span></span><strong className={item.type === "PARTNER_PAYOUT_REVERSAL" ? "text-red-300" : "text-white"}>{item.type === "PARTNER_PAYOUT_REVERSAL" ? "−" : ""}{money(item.amount)}</strong></li>)}</ul></div>}
  </section>;
}
