"use client";

import { useSession } from "next-auth/react";
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, FilterX, Plus, RefreshCw, Users } from "lucide-react";

import ClientSearch from "@/components/clients/ClientSearch";
import ClientTable from "@/components/clients/ClientTable";
import ClientModal, { type ClientDraft } from "@/components/clients/ClientModal";
import { Client } from "@/lib/types";

type Filters = { cities: string[]; managers: string[]; statuses: string[]; sources: string[] };
const emptyFilters: Filters = { cities: [], managers: [], statuses: [], sources: [] };

export default function ClientsPage() {
  const { data: session } = useSession();
  const director = session?.user.role === "DIRECTOR";
  const [view, setView] = useState<"active" | "deleted">("active");
  const [clients, setClients] = useState<Client[]>([]), [filters, setFilters] = useState(emptyFilters);
  const [search, setSearch] = useState(""), deferredSearch = useDeferredValue(search);
  const [city, setCity] = useState(""), [manager, setManager] = useState(""), [status, setStatus] = useState(""), [source, setSource] = useState("");
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [total, setTotal] = useState(0);
  const [open, setOpen] = useState(false), [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [success, setSuccess] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null), [deleteReason, setDeleteReason] = useState("");

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (view === "deleted") params.set("deletedOnly", "true");
      if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
      if (city) params.set("city", city);
      if (manager) params.set("manager", manager);
      if (status) params.set("status", status);
      if (source) params.set("source", source);
      const response = await fetch(`/api/clients?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось загрузить заявки. Повторите попытку.");
      const result = await response.json();
      setClients(result.data);
      setPages(result.pagination.pages);
      setTotal(result.pagination.total);
      setFilters(result.filters);
    } catch (next) {
      setError(next instanceof Error ? next.message : "Не удалось загрузить заявки");
    } finally {
      setLoading(false);
    }
  }, [city, deferredSearch, manager, page, source, status, view]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadClients(), 0);
    return () => window.clearTimeout(timer);
  }, [loadClients]);

  async function addClient(client: ClientDraft) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...client, whatsapp: client.phone }) });
      const payload = await response.json() as { id?: number; name?: string; phone?: string; city?: string; error?: string; code?: string; existingClient?: { id: number; name: string; phone: string } };
      if (!response.ok && !(response.status === 409 && payload.code === "DUPLICATE_PHONE" && payload.existingClient)) throw new Error(payload.error ?? "Не удалось создать заявку");
      const result = payload.existingClient ? { ...payload.existingClient, city: client.city } : payload as { id: number; name: string; phone: string; city: string };
      setSuccess(payload.existingClient ? `Использована существующая заявка «${result.name || result.phone}»` : `Заявка «${client.name || client.phone}» создана`);
      window.setTimeout(() => setSuccess(""), 4000);
      setPage(1);
      setView("active");
      await loadClients();
      return result;
    } catch (next) {
      setError(next instanceof Error ? next.message : "Не удалось создать заявку");
      throw next;
    } finally {
      setSaving(false);
    }
  }

  async function deleteClient() {
    if (!deleteTarget) return;
    setSaving(true);
    setError("");
    const response = await fetch(`/api/clients/${deleteTarget.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: deleteReason }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось удалить заявку из рабочего списка");
    else {
      setSuccess("Заявка удалена из рабочего списка; связанные данные сохранены");
      setDeleteTarget(null);
      setDeleteReason("");
      await loadClients();
    }
    setSaving(false);
  }

  async function restoreClient(client: Client) {
    setSaving(true);
    setError("");
    const response = await fetch(`/api/clients/${client.id}/restore`, { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось восстановить заявку");
    else {
      setSuccess("Заявка восстановлена в рабочем списке");
      await loadClients();
    }
    setSaving(false);
  }

  const statistics = useMemo(() => ({ total, newClients: clients.filter((client) => client.status === "Новый").length, working: clients.filter((client) => !["Новый", "Завершено"].includes(client.status)).length, orders: clients.reduce((sum, client) => sum + (client._count?.orders ?? 0), 0) }), [clients, total]);
  const clear = () => { setSearch(""); setCity(""); setManager(""); setStatus(""); setSource(""); setPage(1); };

  return <section className="flex-1 space-y-6 overflow-auto p-4 md:p-8">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-3xl font-bold text-white">Заявки</h1><p className="mt-1 text-slate-400">Расчёт, КП и следующий контакт без лишних действий</p></div>{view === "active" && <button onClick={() => setOpen(true)} className="flex min-h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-700"><Plus size={18} />Создать заявку</button>}</header>
    {director && <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-700 bg-[#101827] p-2 sm:w-fit"><button onClick={() => { setView("active"); setPage(1); }} className={`min-h-11 rounded-lg px-4 ${view === "active" ? "bg-blue-600 text-white" : "text-slate-300"}`}>Активные</button><button onClick={() => { setView("deleted"); setPage(1); }} className={`min-h-11 rounded-lg px-4 ${view === "deleted" ? "bg-slate-700 text-white" : "text-slate-300"}`}>Удалённые</button></div>}
    {success && <div role="status" className="flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-green-300"><CheckCircle2 size={20} />{success}</div>}
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300"><span className="flex items-center gap-2"><AlertCircle size={20} />{error}</span><button onClick={() => void loadClients()} className="flex min-h-11 items-center gap-2 rounded-lg bg-red-500/20 px-3"><RefreshCw size={15} />Повторить</button></div>}
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4"><Stat title={view === "deleted" ? "Удалено" : "Всего заявок"} value={statistics.total} /><Stat title="Новые на странице" value={statistics.newClients} /><Stat title="В работе" value={statistics.working} /><Stat title="Связанные заказы" value={statistics.orders} /></div>
    <div className="rounded-2xl border border-slate-700 bg-[#101827] p-4"><ClientSearch value={search} onChange={(value) => { setPage(1); setSearch(value); }} /><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Filter value={manager} onChange={setManager} label="Все менеджеры" options={filters.managers} /><Filter value={city} onChange={setCity} label="Все города" options={filters.cities} /><Filter value={status} onChange={setStatus} label="Все статусы" options={filters.statuses} /><Filter value={source} onChange={setSource} label="Все источники" options={filters.sources} /><button onClick={clear} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-slate-200 hover:bg-slate-700"><FilterX size={17} />Сбросить</button></div></div>
    {loading ? <div aria-label="Загрузка заявок" aria-live="polite" className="space-y-3 rounded-2xl border border-slate-700 bg-[#101827] p-5">{Array.from({ length: 5 }).map((_, index) => <div key={index} className="h-20 animate-pulse rounded-xl bg-slate-900" />)}</div> : clients.length ? <ClientTable clients={clients} deletedView={view === "deleted"} onDelete={setDeleteTarget} onRestore={(client) => void restoreClient(client)} /> : <div className="rounded-2xl border border-dashed border-slate-700 bg-[#101827] p-12 text-center"><Users className="mx-auto text-slate-500" size={42} /><h2 className="mt-4 text-xl font-semibold text-white">{view === "deleted" ? "Удалённых заявок нет" : "Заявки не найдены"}</h2><p className="mt-2 text-slate-400">{view === "deleted" ? "Удалённые из рабочего списка заявки появятся здесь." : "Сбросьте фильтры или добавьте новую заявку."}</p></div>}
    <nav aria-label="Страницы заявок" className="flex items-center justify-between rounded-xl border border-slate-700 bg-[#101827] p-3"><button disabled={page === 1} onClick={() => setPage((current) => current - 1)} className="min-h-11 rounded-lg bg-slate-800 px-4 text-white disabled:opacity-40">← Назад</button><span className="text-sm text-slate-300">{page} из {pages}</span><button disabled={page >= pages} onClick={() => setPage((current) => current + 1)} className="min-h-11 rounded-lg bg-slate-800 px-4 text-white disabled:opacity-40">Далее →</button></nav>
    <ClientModal open={open} saving={saving} onClose={() => setOpen(false)} onSave={addClient} />
    {deleteTarget && <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-black/75 p-4" role="dialog" aria-modal="true"><div className="w-full max-w-lg rounded-2xl border border-red-800 bg-slate-950 p-5"><h2 className="text-xl font-bold text-white">Удалить заявку из рабочего списка?</h2><p className="mt-3 text-sm text-slate-300">Связанные замеры и история будут сохранены в системе, но заявка больше не будет отображаться в активной работе.</p>{(deleteTarget._count?.orders ?? 0) > 0 && <div className="mt-3 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200"><p>По этой заявке существует связанный заказ.</p><p className="mt-1 font-semibold">Удалить только заявку из рабочего списка.</p></div>}<label className="mt-4 block text-sm text-slate-300">Причина (необязательно)<textarea rows={3} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => { setDeleteTarget(null); setDeleteReason(""); }} className="min-h-11 rounded-xl bg-slate-800 px-4 text-slate-200">Отмена</button><button disabled={saving} onClick={() => void deleteClient()} className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white disabled:opacity-50">Удалить заявку</button></div></div></div>}
  </section>;
}

function Stat({ title, value }: { title: string; value: number }) { return <div className="rounded-xl border border-slate-700 bg-[#101827] p-4"><p className="text-sm text-slate-400">{title}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>; }
function Filter({ value, onChange, label, options }: { value: string; onChange: (value: string) => void; label: string; options: string[] }) { return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white outline-none focus:border-blue-500"><option value="">{label}</option>{options.map((option) => <option key={option}>{option}</option>)}</select>; }
