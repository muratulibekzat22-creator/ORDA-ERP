"use client";

import { DocumentType } from "@prisma/client";
import { Eye, FileCheck, FileSpreadsheet, FileText, Plus, Printer, Trash2, X } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type DocumentItem = { id: number; type: DocumentType; number: string; documentDate: string; order: { id: number; number: string; client: { name: string } } };
type OrderOption = { id: number; number: string; client: { name: string } };

const typeMeta: Record<DocumentType, { label: string; short: string; href: (id: number) => string }> = {
  OFFER: { label: "Коммерческое предложение", short: "КП", href: (id) => `/orders/${id}/offer` },
  CONTRACT: { label: "Договор", short: "Договоры", href: (id) => `/orders/${id}/contract` },
  INVOICE: { label: "Счёт на оплату", short: "Счета", href: (id) => `/orders/${id}/invoice` },
  ACT: { label: "Акт выполненных работ", short: "Акты", href: (id) => `/orders/${id}/act` },
};

const initialForm: { orderId: string; type: DocumentType; number: string; documentDate: string } = { orderId: "", type: DocumentType.OFFER, number: "", documentDate: new Date().toISOString().slice(0, 10) };

export default function DocumentsPage() {
  const { data: session } = useSession();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [orders, setOrders] = useState<OrderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"" | DocumentType>("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(initialForm);
  const canManage = session?.user.role === "DIRECTOR" || session?.user.role === "MANAGER";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Не удалось загрузить документы");
      setDocuments(await response.json() as DocumentItem[]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось загрузить документы");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function showCreate() {
    setError("");
    if (!orders.length) {
      const response = await fetch("/api/orders", { cache: "no-store" });
      if (!response.ok) return setError("Не удалось загрузить заказы");
      setOrders(await response.json() as OrderOption[]);
    }
    setOpen(true);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...form, orderId: Number(form.orderId) }),
      });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "Не удалось создать документ");
      setOpen(false);
      setForm(initialForm);
      await load();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Не удалось создать документ");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить документ?")) return;
    setSaving(true);
    const response = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
    if (!response.ok) setError((await response.json() as { error?: string }).error ?? "Не удалось удалить документ");
    else await load();
    setSaving(false);
  }

  const visible = useMemo(() => documents.filter((document) => {
    const search = query.trim().toLocaleLowerCase("ru");
    return (!type || document.type === type) && (!search || [document.number, document.order.number, document.order.client.name].some((value) => value.toLocaleLowerCase("ru").includes(search)));
  }), [documents, query, type]);

  return <section className="flex-1 overflow-auto p-4 md:p-8">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="text-3xl font-bold text-white">Документы</h1><p className="mt-2 text-slate-400">КП, договоры, счета и акты по реальным заказам</p></div>
      {canManage && <button onClick={() => void showCreate()} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700"><Plus size={18}/>Создать документ</button>}
    </div>
    {error && <p className="mb-5 rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300">{error}</p>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Object.values(DocumentType).map((value, index) => { const count = documents.filter((item) => item.type === value).length; const Icon = index === 0 ? FileText : index === 2 ? FileSpreadsheet : FileCheck; return <div key={value} className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><Icon className="mb-3 text-blue-400"/><p className="text-slate-400">{typeMeta[value].short}</p><p className="mt-1 text-3xl font-bold text-white">{count}</p></div>; })}
    </div>
    <div className="mb-5 flex flex-wrap gap-3">
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, заказ или клиент" className="min-w-64 flex-1 rounded-xl border border-slate-700 bg-[#101827] px-4 py-3 text-white"/>
      <select value={type} onChange={(event) => setType(event.target.value as "" | DocumentType)} className="rounded-xl border border-slate-700 bg-[#101827] px-4 py-3 text-white"><option value="">Все типы</option>{Object.values(DocumentType).map((value) => <option key={value} value={value}>{typeMeta[value].label}</option>)}</select>
    </div>
    <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
      {loading ? <p className="p-8 text-slate-400">Загрузка документов…</p> : !visible.length ? <p className="p-8 text-slate-400">Документы не найдены</p> : <table className="w-full min-w-[760px] text-left"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-4">№</th><th className="p-4">Тип</th><th className="p-4">Заказ</th><th className="p-4">Клиент</th><th className="p-4">Дата</th><th className="p-4 text-right">Действия</th></tr></thead><tbody>{visible.map((document) => { const href = typeMeta[document.type].href(document.order.id); return <tr key={document.id} className="border-t border-slate-800 text-slate-300"><td className="p-4 font-semibold text-white">{document.number}</td><td className="p-4">{typeMeta[document.type].label}</td><td className="p-4">{document.order.number}</td><td className="p-4">{document.order.client.name}</td><td className="p-4">{new Intl.DateTimeFormat("ru-RU").format(new Date(document.documentDate))}</td><td className="p-4"><div className="flex justify-end gap-2"><Link title="Открыть" href={href} className="rounded-lg bg-slate-800 p-2 hover:bg-slate-700"><Eye size={18}/></Link><Link title="Печать" href={href} className="rounded-lg bg-green-700 p-2 hover:bg-green-600"><Printer size={18}/></Link>{canManage && <button disabled={saving} title="Удалить" onClick={() => void remove(document.id)} className="rounded-lg bg-red-900 p-2 hover:bg-red-800 disabled:opacity-50"><Trash2 size={18}/></button>}</div></td></tr>; })}</tbody></table>}
    </div>
    {open && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><form onSubmit={submit} className="w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-[#101827] p-6"><div className="flex items-center justify-between"><h2 className="text-xl font-bold text-white">Новый документ</h2><button type="button" onClick={() => setOpen(false)} className="text-slate-400"><X/></button></div><select required value={form.orderId} onChange={(event) => setForm({ ...form, orderId: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"><option value="">Выберите заказ</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.number} — {order.client.name}</option>)}</select><select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as DocumentType })} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white">{Object.values(DocumentType).map((value) => <option key={value} value={value}>{typeMeta[value].label}</option>)}</select><input required maxLength={80} value={form.number} onChange={(event) => setForm({ ...form, number: event.target.value })} placeholder="Номер документа" className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"/><input required type="date" value={form.documentDate} onChange={(event) => setForm({ ...form, documentDate: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"/><button disabled={saving} className="w-full rounded-xl bg-blue-600 p-3 font-semibold text-white disabled:opacity-50">{saving ? "Сохранение…" : "Создать"}</button></form></div>}
  </section>;
}
