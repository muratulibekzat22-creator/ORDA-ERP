"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import CalendarAgenda from "@/components/dashboard/CalendarAgenda";
import DashboardStats from "@/components/dashboard/DashboardStats";
import OrderTable from "@/components/orders/OrderTable";
import { hasDefaultPermission, type Permission } from "@/lib/permissions";
import { Role } from "@/lib/roles";

type Client = { id: number; name: string; phone: string };
type Order = { id: number; number: string; amount: string; prepayment: string; balance: string; partnerPrice?: string; partnerBalance?: string; companyProfit?: string; client: { name: string; phone: string }; material: string; staircase: string; manager: string; status: string };
type Production = { id: number; stage: string; percent: number; order: { number: string } };

const request = async <T,>(url: string): Promise<T | null> => {
  const response = await fetch(url);
  return response.ok ? response.json() as Promise<T> : null;
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const role = session?.user?.role as Role | undefined;
  const can = useCallback((permission: Permission) => Boolean(role && hasDefaultPermission(role, permission)), [role]);
  const [clients, setClients] = useState<Client[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadDashboard = useCallback(async () => {
    if (!role) return;
    setLoading(true);
    setError("");
    try {
      const [clientsPayload, ordersPayload, productionsPayload] = await Promise.all([
        can("clients") ? request<{ data: Client[] }>("/api/clients") : Promise.resolve(null),
        can("orders") ? request<Order[]>("/api/orders") : Promise.resolve(null),
        can("production") ? request<Production[]>("/api/production") : Promise.resolve(null),
      ]);
      setClients(clientsPayload?.data ?? []);
      setOrders(ordersPayload ?? []);
      setProductions(productionsPayload ?? []);
    } catch {
      setError("Не удалось загрузить данные Dashboard");
    } finally {
      setLoading(false);
    }
  }, [can, role]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDashboard(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDashboard]);

  const totals = useMemo(() => orders.reduce((value, order) => ({
    amount: value.amount + Number(order.amount),
    profit: value.profit + Number(order.companyProfit ?? 0),
    debt: value.debt + Number(order.balance),
    partnerBalance: value.partnerBalance + Number(order.partnerBalance ?? 0),
  }), { amount: 0, profit: 0, debt: 0, partnerBalance: 0 }), [orders]);

  const shortcuts = [
    can("orders") && { href: "/orders", label: "Новый заказ", color: "bg-green-600" },
    can("calendar") && { href: "/calendar", label: "Календарь", color: "bg-yellow-500 text-black" },
    can("production") && { href: "/production", label: "Производство", color: "bg-purple-600" },
    { href: "/calculator", label: "Калькулятор", color: "bg-slate-700" },
  ].filter(Boolean) as Array<{ href: string; label: string; color: string }>;

  return (
    <section className="space-y-8 p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h1 className="text-4xl font-bold text-white">ORDA ERP</h1><p className="text-slate-400">Главная панель управления ALTYN SAPA</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-sm font-medium text-amber-200">Внутреннее тестирование</span>
          <span className="text-sm text-slate-400">v0.9.0 Beta</span>
          <button type="button" onClick={() => window.alert("Сообщите руководителю о найденной ошибке.")} className="rounded-xl border border-slate-600 bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">Сообщить об ошибке</button>
        </div>
      </div>
      {error && <p className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-300">{error}</p>}
      <DashboardStats totalClients={clients.length} totalOrders={orders.length} totalProduction={productions.length} totalRevenue={totals.amount} totalProfit={totals.profit} totalDebt={totals.debt} totalPartnerBalance={totals.partnerBalance} />
      <div className="grid gap-6 lg:grid-cols-3">
        <section className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><h2 className="mb-4 text-xl font-bold text-white">Последние клиенты</h2>{clients.length ? <div className="space-y-3">{clients.slice(0, 5).map((client) => <Link key={client.id} href={`/clients/${client.id}`} className="block rounded-xl bg-slate-900 p-4 hover:bg-slate-800"><p className="font-semibold text-white">{client.name}</p><p className="text-sm text-slate-400">{client.phone}</p></Link>)}</div> : <p className="text-slate-400">Нет доступных клиентов.</p>}</section>
        <section className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><h2 className="mb-4 text-xl font-bold text-white">Производство</h2>{productions.length ? <div className="space-y-3">{productions.slice(0, 5).map((item) => <Link key={item.id} href="/production" className="block rounded-xl bg-slate-900 p-4 hover:bg-slate-800"><p className="font-semibold text-white">{item.order.number}</p><p className="text-slate-400">{item.stage}</p><p className="mt-1 font-bold text-yellow-400">{item.percent}%</p></Link>)}</div> : <p className="text-slate-400">Нет доступных этапов.</p>}</section>
        <section className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><h2 className="mb-4 text-xl font-bold text-white">Быстрые действия</h2><div className="space-y-3">{shortcuts.map((item) => <Link key={item.href} href={item.href} className={`block w-full rounded-xl px-4 py-3 text-center text-white ${item.color}`}>{item.label}</Link>)}</div></section>
      </div>
      {can("calendar") && <CalendarAgenda />}
      <section><div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold text-white">Последние заказы</h2><Link href="/orders" className="text-sm text-blue-400 hover:text-blue-300">Все заказы</Link></div>{loading ? <p className="text-slate-400">Загрузка...</p> : orders.length ? <OrderTable orders={orders.slice(0, 10)} /> : <p className="text-slate-400">Нет доступных заказов.</p>}</section>
    </section>
  );
}
