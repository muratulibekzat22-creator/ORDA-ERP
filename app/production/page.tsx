"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import ProductionEditor, { type ProductionEditorPayload, type ProductionOptions } from "@/components/production/ProductionEditor";
import ProductionKanban, { type ProductionKanbanItem } from "@/components/production/ProductionKanban";
import { distributeProductions, EMPTY_PRODUCTION_FILTERS, filterProductions, isProductionOverdue, optimisticProductionMove, type ProductionKanbanFilter } from "@/lib/production/kanban";
import { PRODUCTION_STAGES, type ProductionStage } from "@/lib/production/stage-policy";

const emptyOptions: ProductionOptions = { orders: [], assignees: [] };

export default function ProductionPage() {
  const [productions, setProductions] = useState<ProductionKanbanItem[]>([]);
  const [options, setOptions] = useState<ProductionOptions>(emptyOptions);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  const [editor, setEditor] = useState<ProductionKanbanItem | "new" | null>(null);
  const [editorSaving, setEditorSaving] = useState(false);
  const [filters, setFilters] = useState<ProductionKanbanFilter>(EMPTY_PRODUCTION_FILTERS);

  const loadProductions = useCallback(async () => {
    const response = await fetch("/api/production", { cache: "no-store" });
    const payload = await response.json() as ProductionKanbanItem[] | { error?: string };
    if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Не удалось загрузить производство");
    setProductions(payload as ProductionKanbanItem[]);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/auth/session").then((response) => response.json()),
      fetch("/api/production", { cache: "no-store" }).then(async (response) => {
        const payload = await response.json() as ProductionKanbanItem[] | { error?: string };
        if (!response.ok) throw new Error("error" in payload && payload.error ? payload.error : "Не удалось загрузить производство");
        return payload as ProductionKanbanItem[];
      }),
    ])
      .then(async ([session, productionItems]) => {
        if (!active) return;
        setProductions(productionItems);
        const currentRole = String(session?.user?.role ?? "");
        setRole(currentRole);
        if (["DIRECTOR", "MANAGER"].includes(currentRole)) {
          const response = await fetch("/api/production?view=options", { cache: "no-store" });
          if (response.ok && active) setOptions(await response.json() as ProductionOptions);
        }
      })
      .catch((reason: unknown) => active && setError(reason instanceof Error ? reason.message : "Не удалось загрузить Kanban"))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [loadProductions]);

  const canManage = role === "DIRECTOR" || role === "MANAGER";
  const assignees = useMemo(() => {
    const values = new Map<number, string>();
    for (const item of productions) if (item.masterUserId) values.set(item.masterUserId, item.master || `#${item.masterUserId}`);
    for (const item of options.assignees) values.set(item.id, item.name);
    return [...values.entries()].sort((a, b) => a[1].localeCompare(b[1], "ru"));
  }, [options.assignees, productions]);
  const visible = useMemo(() => filterProductions(productions, filters), [filters, productions]);
  const columns = useMemo(() => distributeProductions(visible), [visible]);

  async function moveCard(id: number, stage: ProductionStage) {
    const current = productions.find((item) => item.id === id);
    if (!current || current.stage === stage || savingIds.has(id)) return;
    const snapshot = productions;
    setSavingIds((ids) => new Set(ids).add(id));
    setProductions((items) => optimisticProductionMove(items, id, stage));
    setError("");
    try {
      const response = await fetch("/api/production", { method: "PATCH", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ id, stage }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Переход запрещён");
      await loadProductions();
    } catch (reason) {
      setProductions(snapshot);
      setError(reason instanceof Error ? reason.message : "Карточка возвращена на исходную стадию");
    } finally {
      setSavingIds((ids) => { const next = new Set(ids); next.delete(id); return next; });
    }
  }

  async function saveEditor(payload: ProductionEditorPayload) {
    const item = editor === "new" ? null : editor;
    setEditorSaving(true);
    setError("");
    try {
      const response = await fetch("/api/production", { method: item ? "PATCH" : "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify(item ? { id: item.id, ...payload } : payload) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось сохранить производственную задачу");
      setEditor(null);
      await loadProductions();
      const optionResponse = await fetch("/api/production?view=options", { cache: "no-store" });
      if (optionResponse.ok) setOptions(await optionResponse.json() as ProductionOptions);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось сохранить производственную задачу");
    } finally {
      setEditorSaving(false);
    }
  }

  if (loading) return <section role="status" aria-live="polite" className="space-y-4 p-4 md:p-8"><span className="sr-only">Загрузка производства</span><div className="h-20 animate-pulse rounded-2xl bg-slate-800"/><div className="h-72 animate-pulse rounded-2xl bg-slate-800"/></section>;

  return (
    <section className="space-y-6 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-2xl font-bold text-white sm:text-3xl">Производство</h1><p className="text-slate-400">Ежедневная очередь производства ALTYN SAPA</p></div>{canManage && <button type="button" onClick={() => setEditor("new")} className="min-h-11 w-full rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white sm:w-auto">Добавить производство</button>}</header>
      <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 md:grid-cols-3 xl:grid-cols-6">
        <input aria-label="Поиск" placeholder="Заказ или клиент" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} className="rounded-lg bg-slate-900 p-3 text-white" />
        <select aria-label="Фильтр по стадии" value={filters.stage} onChange={(event) => setFilters({ ...filters, stage: event.target.value as "" | ProductionStage })} className="rounded-lg bg-slate-900 p-3"><option value="">Все стадии</option>{PRODUCTION_STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select>
        <select aria-label="Фильтр по ответственному" value={filters.assigneeId} onChange={(event) => setFilters({ ...filters, assigneeId: event.target.value ? Number(event.target.value) : "" })} className="rounded-lg bg-slate-900 p-3"><option value="">Все ответственные</option>{assignees.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <select aria-label="Фильтр по приоритету" value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value ? Number(event.target.value) : "" })} className="rounded-lg bg-slate-900 p-3"><option value="">Все приоритеты</option>{[0, 1, 2, 3, 4, 5].map((priority) => <option key={priority} value={priority}>P{priority}</option>)}</select>
        <label className="flex items-center gap-2 rounded-lg bg-slate-900 p-3 text-sm"><input type="checkbox" checked={filters.overdueOnly} onChange={(event) => setFilters({ ...filters, overdueOnly: event.target.checked })} />Только просроченные</label>
        <button type="button" onClick={() => setFilters(EMPTY_PRODUCTION_FILTERS)} className="rounded-lg bg-slate-800 p-3 text-white">Сбросить фильтры</button>
      </div>
      <div className="grid gap-3 sm:grid-cols-3"><Stat label="Всего" value={productions.length} /><Stat label="Просрочено" value={productions.filter((item) => isProductionOverdue(item)).length} /><Stat label="Показано" value={visible.length} /></div>
      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">{error}</p>}
      {!productions.length ? <div className="rounded-2xl border border-dashed border-slate-700 py-16 text-center text-slate-400">Производственных задач пока нет</div> : <ProductionKanban columns={columns} savingIds={savingIds} onDropCard={moveCard} onEdit={canManage ? (item) => setEditor(item) : undefined} />}
      <div className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Фото и файлы будут подключены после выбора файлового хранилища.</div>
      {editor && <ProductionEditor item={editor === "new" ? null : editor} options={options} saving={editorSaving} onClose={() => setEditor(null)} onSave={saveEditor} />}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) { return <div className="rounded-xl border border-slate-700 bg-[#101827] p-4"><p className="text-sm text-slate-400">{label}</p><p className="mt-1 text-2xl font-bold text-white">{value}</p></div>; }
