"use client";
import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
type Dashboard = {
  activeOrders: number;
  totals: { price: number; paid: number; balance: number };
  statuses: Record<string, number>;
  recentPayments: Array<{
    id: number;
    amount: number;
    method: string;
    comment: string | null;
    operationDate: string;
    order: { number: string };
  }>;
};
export default function PartnerPage() {
  const [d, setD] = useState<Dashboard | null>(null),
    [orders, setOrders] = useState<
      Array<{
        id: number;
        number: string;
        status: string;
        address: string;
        material: string;
        partnerPrice: string;
        partnerPaid: string;
        partnerBalance: string;
      }>
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([fetch("/api/partner/dashboard"), fetch("/api/orders")])
      .then(async ([a, b]) => {
        if (!a.ok || !b.ok) throw new Error("Не удалось загрузить кабинет");
        setD((await a.json()) as Dashboard);
        setOrders(await b.json());
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Ошибка"));
  }, []);
  const money = (v: number | string) =>
    `${Number(v).toLocaleString("ru-RU")} ₸`;
  return (
    <main className="min-h-screen bg-slate-950 p-5 text-white md:p-8">
      <header className="mb-6 flex justify-between">
        <div>
          <h1 className="text-3xl font-bold">Кабинет цеха</h1>
          <p className="text-slate-400">Только ваши заказы и выплаты</p>
        </div>
        <button onClick={() => void signOut({ callbackUrl: "/login" })}>
          Выйти
        </button>
      </header>
      {error && <p className="text-red-400">{error}</p>}
      {d && (
        <div className="grid gap-3 md:grid-cols-4">
          {[
            ["Активные", d.activeOrders],
            ["Сумма", money(d.totals.price)],
            ["Выплачено", money(d.totals.paid)],
            ["Остаток", money(d.totals.balance)],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-xl bg-slate-900 p-4">
              <p className="text-slate-400">{k}</p>
              <b>{v}</b>
            </div>
          ))}
        </div>
      )}
      <section className="mt-6 rounded-xl bg-slate-900 p-5">
        <h2 className="text-xl font-semibold">Мои заказы</h2>
        {orders.map((o) => (
          <div key={o.id} className="mt-3 border-t border-slate-700 pt-3">
            <b>{o.number}</b> · {o.status}
            <br />
            {o.address} · {o.material}
            <br />
            Стоимость работ цеха: {money(o.partnerPrice)} · Выплачено цеху:{" "}
            {money(o.partnerPaid)} · Остаток выплаты цеху: {money(o.partnerBalance)}
          </div>
        ))}
        {!orders.length && (
          <p className="mt-3 text-slate-400">Заказов пока нет.</p>
        )}
      </section>
      {d && (
        <section className="mt-6 rounded-xl bg-slate-900 p-5">
          <h2 className="text-xl font-semibold">Последние выплаты</h2>
          {d.recentPayments.map((p) => (
            <p key={p.id} className="mt-2">
              {p.order.number} — {money(p.amount)} · {p.method}
            </p>
          ))}
        </section>
      )}
    </main>
  );
}
