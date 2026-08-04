"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

type NumericValue = string | number | { toString(): string };

interface Props {
  order: {
    id: number;
    number: string;
    status: string;
    address: string;
    material: string;
    staircase: string;
    amount: NumericValue;
    partnerPrice: NumericValue;
    companyProfit: NumericValue;
    partnerPaid: NumericValue;
    partnerBalance: NumericValue;
    prepayment: NumericValue;
    balance: NumericValue;
    client?: { name?: string; phone?: string } | null;
    partner?: { name?: string } | null;
  };
}

const statuses = ["Новая заявка", "Замер", "Проектирование", "Заготовка", "Покраска", "Заказ готов", "Монтаж", "Сдано"];

function statusColor(status: string) {
  switch (status) {
    case "Новая заявка": return "bg-blue-600";
    case "Замер": return "bg-yellow-500 text-black";
    case "Проектирование":
    case "Заготовка": return "bg-purple-600";
    case "Покраска":
    case "Заказ готов": return "bg-cyan-600";
    case "Монтаж": return "bg-orange-600";
    case "Сдано": return "bg-green-600";
    default: return "bg-slate-700";
  }
}

export default function OrderCard({ order }: Props) {
  const router = useRouter();
  const { getKey: getAssignPartnerKey, reset: resetAssignPartnerKey } = useIdempotencyKey();
  const [status, setStatus] = useState(order.status);
  const [isSavingStatus, setIsSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [partners, setPartners] = useState<Array<{ id: number; name: string }>>([]);
  const [partnerId, setPartnerId] = useState("");
  const [partnerPrice, setPartnerPrice] = useState("");
  const [partnerModal, setPartnerModal] = useState(false);
  const [isAssigningPartner, setIsAssigningPartner] = useState(false);

  async function changeStatus(nextStatus: string) {
    if (nextStatus === status) return;
    setIsSavingStatus(true);
    setStatusError("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: nextStatus }),
      });
      if (!response.ok) throw new Error("Unable to update order status");
      const updatedOrder: { status: string } = await response.json();
      setStatus(updatedOrder.status);
      router.refresh();
    } catch (error) {
      console.error(error);
      setStatusError("Не удалось сохранить статус. Попробуйте ещё раз.");
    } finally {
      setIsSavingStatus(false);
    }
  }

  useEffect(() => {
    if (!partnerModal) {
      resetAssignPartnerKey();
      return;
    }
    void fetch("/api/partners")
      .then((response) => response.ok ? response.json() : [])
      .then((items: Array<{ id: number; name: string; active: boolean }>) => setPartners(items.filter((item) => item.active)))
      .catch(() => setStatusError("Не удалось загрузить список партнёров."));
  }, [partnerModal, resetAssignPartnerKey]);

  async function assignPartner() {
    setIsAssigningPartner(true);
    setStatusError("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getAssignPartnerKey(),
        },
        body: JSON.stringify({ action: "assignPartner", partnerId: Number(partnerId), partnerPrice: Number(partnerPrice) }),
      });
      if (!response.ok) throw new Error("Unable to assign partner");
      const updatedOrder: { status: string } = await response.json();
      setStatus(updatedOrder.status);
      resetAssignPartnerKey();
      setPartnerModal(false);
      router.refresh();
    } catch (error) {
      console.error(error);
      setStatusError("Не удалось передать заказ партнёру.");
    } finally {
      setIsAssigningPartner(false);
    }
  }

  const money = (value: NumericValue) => `${Number(value).toLocaleString()} ₸`;
  const cards = [
    ["Стоимость клиенту", order.amount, "text-green-400"],
    ["Стоимость партнёра", order.partnerPrice, "text-blue-400"],
    ["Прибыль ALTYN SAPA", order.companyProfit, "text-yellow-400"],
    ["Выплачено партнёру", order.partnerPaid, "text-cyan-400"],
    ["Осталось партнёру", order.partnerBalance, "text-red-400"],
    ["Предоплата клиента", order.prepayment, "text-cyan-400"],
    ["Остаток клиента", order.balance, "text-orange-400"],
  ] as const;

  return <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">
    <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold text-white">Заказ {order.number}</h2><p className="mt-2 text-slate-400">{order.client?.name}</p>{order.partner?.name && <p className="mt-1 text-sm text-cyan-400">Партнёр: {order.partner.name}</p>}</div><div className="min-w-52"><select aria-label="Статус заказа" value={status} disabled={isSavingStatus} onChange={(event) => changeStatus(event.target.value)} className={`w-full rounded-xl px-4 py-2 font-medium outline-none transition disabled:cursor-wait disabled:opacity-70 ${statusColor(status)}`}>{!statuses.includes(status) && <option value={status}>{status}</option>}{statuses.map((item) => <option key={item} value={item}>{item}</option>)}</select>{statusError && <p className="mt-2 text-sm text-red-400">{statusError}</p>}</div></div>
    <div className="mt-8 grid grid-cols-2 gap-6"><div><p className="text-slate-400">Телефон</p><p className="text-white">{order.client?.phone}</p></div><div><p className="text-slate-400">Адрес</p><p className="text-white">{order.address}</p></div><div><p className="text-slate-400">Материал</p><p className="text-white">{order.material}</p></div><div><p className="text-slate-400">Тип лестницы</p><p className="text-white">{order.staircase}</p></div>{cards.map(([title, value, color]) => <div key={title} className="rounded-xl bg-slate-900 p-4"><p className="text-slate-400">{title}</p><p className={`mt-2 text-3xl font-bold ${color}`}>{money(value)}</p></div>)}</div>
    <div className="mt-8 flex flex-wrap gap-4"><button type="button" onClick={() => setPartnerModal(true)} className="rounded-xl bg-green-600 px-6 py-3 text-white transition hover:bg-green-700">Передать партнёру</button><Link href={`/orders/${order.id}/offer`} className="rounded-xl bg-yellow-500 px-6 py-3 font-semibold text-black transition hover:bg-yellow-400">Коммерческое предложение</Link><Link href={`/orders/${order.id}/contract`} className="rounded-xl bg-indigo-600 px-6 py-3 text-white transition hover:bg-indigo-700">Договор</Link><Link href={`/orders/${order.id}/print`} target="_blank" className="rounded-xl bg-slate-700 px-6 py-3 text-white transition hover:bg-slate-600">Печать</Link><Link href={`/orders/${order.id}`} className="rounded-xl bg-blue-600 px-6 py-3 text-white transition hover:bg-blue-700">Подробнее</Link></div>
    {partnerModal && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"><div className="w-full max-w-md space-y-4 rounded-2xl bg-[#101827] p-6"><h2 className="text-xl font-bold text-white">Передать партнёру</h2><select value={partnerId} onChange={(event) => setPartnerId(event.target.value)} className="w-full rounded-xl bg-slate-900 p-3 text-white"><option value="">Выберите партнёра</option>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select><input type="number" min="0" placeholder="Стоимость партнёра" value={partnerPrice} onChange={(event) => setPartnerPrice(event.target.value)} className="w-full rounded-xl bg-slate-900 p-3 text-white"/><div className="flex gap-3"><button type="button" disabled={!partnerId || !partnerPrice || isAssigningPartner} onClick={assignPartner} className="rounded-xl bg-green-600 px-5 py-3 text-white disabled:opacity-50">{isAssigningPartner ? "Сохранение..." : "Сохранить"}</button><button type="button" disabled={isAssigningPartner} onClick={() => setPartnerModal(false)} className="rounded-xl bg-slate-700 px-5 py-3 text-white">Отмена</button></div></div></div>}
  </div>;
}
