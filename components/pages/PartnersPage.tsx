"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

interface Partner {
  id: number;
  name: string;
  phone?: string | null;
  city?: string | null;
  email?: string | null;
  active: boolean;
  orders: Array<{ id: number; amount: string; partnerPaid: string; partnerBalance: string; companyProfit: string }>;
  stats: { totalOrders: number; totalAmount: number; partnerPaid: number; partnerBalance: number; companyProfit: number };
}

type PartnerForm = { name: string; phone: string; city: string; email: string };
const emptyForm: PartnerForm = { name: "", phone: "", city: "", email: "" };

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [form, setForm] = useState<PartnerForm>(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadPartners() {
    setLoading(true);
    try {
      const response = await fetch("/api/partners");
      if (!response.ok) throw new Error("Не удалось загрузить данные цеха.");
      setPartners(await response.json() as Partner[]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные цеха.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetch("/api/partners")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные цеха.");
        return response.json() as Promise<Partner[]>;
      })
      .then((data) => setPartners(data))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить данные цеха."))
      .finally(() => setLoading(false));
  }, []);

  function openCreate() { setEditingId(null); setForm(emptyForm); setError(""); setIsFormOpen(true); }
  function openEdit(partner: Partner) { setEditingId(partner.id); setForm({ name: partner.name, phone: partner.phone ?? "", city: partner.city ?? "", email: partner.email ?? "" }); setError(""); setIsFormOpen(true); }

  async function savePartner(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.name.trim()) { setError("Укажите название цеха."); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch(editingId ? `/api/partners/${editingId}` : "/api/partners", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const payload: { error?: string } = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить цех.");
      setIsFormOpen(false);
      await loadPartners();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить цех."); }
    finally { setSaving(false); }
  }

  async function togglePartner(partner: Partner) {
    setError("");
    const response = await fetch(`/api/partners/${partner.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: partner.name, phone: partner.phone ?? "", city: partner.city ?? "", email: partner.email ?? "", active: !partner.active }) });
    if (!response.ok) { const payload: { error?: string } = await response.json(); setError(payload.error ?? "Не удалось изменить статус цеха."); return; }
    await loadPartners();
  }

  async function deletePartner(partner: Partner) {
    if (!window.confirm(`Удалить цех «${partner.name}»?`)) return;
    setError("");
    const response = await fetch(`/api/partners/${partner.id}`, { method: "DELETE" });
    if (!response.ok) { const payload: { error?: string } = await response.json(); setError(payload.error ?? "Не удалось удалить цех."); return; }
    await loadPartners();
  }

  return <main className="space-y-8 p-8"><div className="flex items-center justify-between"><div><h1 className="text-3xl font-bold text-white">Цех</h1><p className="mt-2 text-slate-400">Наши производственные цеха и расчёты по заказам</p></div><button type="button" onClick={openCreate} className="rounded-xl bg-yellow-500 px-5 py-3 font-semibold text-black transition hover:bg-yellow-400">+ Новый цех</button></div>
    {error && <p role="alert" className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-red-300">{error}</p>}
    {isFormOpen && <form onSubmit={savePartner} className="grid gap-4 rounded-2xl border border-slate-700 bg-[#101827] p-6 md:grid-cols-2"><h2 className="md:col-span-2 text-xl font-bold text-white">{editingId ? "Редактировать цех" : "Новый цех"}</h2>{(["name", "phone", "city", "email"] as const).map((field) => <label key={field} className="space-y-1 text-sm text-slate-400"><span>{{ name: "Название", phone: "Телефон", city: "Город", email: "E-mail" }[field]}</span><input required={field === "name"} type={field === "email" ? "email" : "text"} value={form[field]} onChange={(event) => setForm({ ...form, [field]: event.target.value })} className="w-full rounded-xl bg-slate-900 p-3 text-white"/></label>)}<div className="flex gap-3 md:col-span-2"><button disabled={saving} className="rounded-xl bg-green-600 px-5 py-3 text-white disabled:opacity-50">{saving ? "Сохранение..." : "Сохранить"}</button><button type="button" onClick={() => setIsFormOpen(false)} className="rounded-xl bg-slate-700 px-5 py-3 text-white">Отмена</button></div></form>}
    {loading ? <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-white">Загрузка...</div> : partners.length === 0 ? <div className="rounded-2xl border border-slate-700 bg-[#101827] p-10 text-center text-slate-400">Цеха пока не добавлены</div> : <div className="grid gap-6">{partners.map((partner) => <PartnerRow key={partner.id} partner={partner} onEdit={openEdit} onToggle={togglePartner} onDelete={deletePartner}/>)}</div>}
  </main>;
}

function PartnerRow({ partner, onEdit, onToggle, onDelete }: { partner: Partner; onEdit: (partner: Partner) => void; onToggle: (partner: Partner) => void; onDelete: (partner: Partner) => void }) {
  return <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6"><div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between"><div><div className="flex items-center gap-3"><h2 className="text-2xl font-bold text-white">{partner.name}</h2><span className={`rounded-lg px-3 py-1 text-sm ${partner.active ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>{partner.active ? "Активен" : "Неактивен"}</span></div><p className="mt-3 text-slate-400">Телефон: {partner.phone || "не указан"}</p><p className="text-slate-400">Город: {partner.city || "не указан"}</p><p className="text-slate-400">E-mail: {partner.email || "не указан"}</p></div><div className="grid grid-cols-2 gap-4 xl:grid-cols-5"><Stat title="Заказы" value={String(partner.stats.totalOrders)} color="text-cyan-400"/><Stat title="Сумма" value={`${partner.stats.totalAmount.toLocaleString()} ₸`} color="text-green-400"/><Stat title="Выплачено" value={`${partner.stats.partnerPaid.toLocaleString()} ₸`} color="text-blue-400"/><Stat title="Долг" value={`${partner.stats.partnerBalance.toLocaleString()} ₸`} color="text-yellow-400"/><Stat title="Прибыль" value={`${partner.stats.companyProfit.toLocaleString()} ₸`} color="text-purple-400"/></div></div><div className="mt-8 flex flex-wrap gap-3"><Link href={`/partners/${partner.id}`} className="rounded-xl bg-blue-600 px-5 py-3 text-white hover:bg-blue-700">Карточка</Link><button type="button" onClick={() => onEdit(partner)} className="rounded-xl bg-slate-700 px-5 py-3 text-white hover:bg-slate-600">Редактировать</button><button type="button" onClick={() => onToggle(partner)} className="rounded-xl bg-amber-600 px-5 py-3 text-white hover:bg-amber-700">{partner.active ? "Деактивировать" : "Активировать"}</button><button type="button" onClick={() => onDelete(partner)} className="rounded-xl bg-red-700 px-5 py-3 text-white hover:bg-red-800">Удалить</button></div></div>;
}

function Stat({ title, value, color }: { title: string; value: string; color: string }) { return <div className="rounded-xl bg-slate-900 p-4 text-center"><p className="text-sm text-slate-400">{title}</p><p className={`mt-2 text-xl font-bold ${color}`}>{value}</p></div>; }
