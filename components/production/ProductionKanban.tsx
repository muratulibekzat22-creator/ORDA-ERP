"use client";

import { CalendarDays, Clock3, MapPin, UserRound } from "lucide-react";

import { isProductionOverdue } from "@/lib/production/kanban";
import { getAllowedProductionStageTransitions, PRODUCTION_STAGES, type ProductionStage } from "@/lib/production/stage-policy";

export type ProductionHistoryItem = {
  id: number;
  fromStage: string | null;
  toStage: string;
  comment: string | null;
  createdAt: string;
  changedBy: { id: number; name: string } | null;
};

export type ProductionKanbanItem = {
  id: number;
  stage: string;
  percent: number;
  master: string;
  masterUserId: number | null;
  priority: number;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  actualEndAt: string | null;
  completedAt: string | null;
  comment: string | null;
  stageHistory: ProductionHistoryItem[];
  order: {
    id: number;
    number: string;
    address: string;
    material: string;
    client: { name: string };
    partner?: { id: number; name: string } | null;
  };
};

type Props = {
  columns: Record<ProductionStage, ProductionKanbanItem[]>;
  savingIds: Set<number>;
  onDropCard: (id: number, stage: ProductionStage) => void;
  onEdit?: (item: ProductionKanbanItem) => void;
  role?: string;
  stageCounts?: Partial<Record<ProductionStage, number>>;
};

const date = (value: string | null) => value ? new Intl.DateTimeFormat("ru-RU").format(new Date(value)) : "—";

export default function ProductionKanban({ columns, savingIds, onDropCard, onEdit, role = "", stageCounts = {} }: Props) {
  return (
    <div className="overflow-x-auto overscroll-x-contain pb-4 [scrollbar-width:thin]">
      <div className="flex min-w-max snap-x snap-mandatory gap-4 xl:grid xl:min-w-0 xl:grid-cols-4 2xl:grid-cols-8">
        {PRODUCTION_STAGES.map((stage) => (
          <section
            key={stage}
            data-stage={stage}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const id = Number(event.dataTransfer.getData("text/production-id"));
              if (Number.isInteger(id)) onDropCard(id, stage);
            }}
            className="w-[calc(100vw-2rem)] max-w-[320px] snap-center rounded-2xl border border-slate-700 bg-[#101827] p-3 sm:w-[310px] xl:w-auto xl:max-w-none"
          >
            <header className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-sm font-bold text-white">{stage}</h2>
              <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{stageCounts[stage] ?? columns[stage].length}</span>
            </header>
            <div className="space-y-3">
              {columns[stage].map((item) => {
                const overdue = isProductionOverdue(item);
                const lastHistory = item.stageHistory[0];
                const saving = savingIds.has(item.id);
                const currentStage = item.stage as ProductionStage;
                const allowedStages = getAllowedProductionStageTransitions(role, currentStage);
                return (
                  <article
                    key={item.id}
                    draggable={!saving}
                    onDragStart={(event) => event.dataTransfer.setData("text/production-id", String(item.id))}
                    className={`rounded-xl border bg-slate-900 p-3 shadow-sm ${overdue ? "border-red-500/70" : "border-slate-700"} ${saving ? "cursor-wait opacity-60" : "cursor-grab"}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div><p className="font-bold text-white">{item.order.number}</p><p className="text-sm text-slate-300">{item.order.client.name}</p></div>
                      <span className="rounded-md bg-blue-500/15 px-2 py-1 text-xs font-semibold text-blue-300">P{item.priority}</span>
                    </div>
                    <p className="mt-2 flex gap-1 text-xs text-slate-400"><MapPin size={14} className="shrink-0" />{item.order.address || "Адрес не указан"}</p>
                    <p className="mt-1 text-xs text-slate-400">Материал: {item.order.material || "—"}</p>
                    <p className="mt-2 flex gap-1 text-xs text-slate-300"><UserRound size={14} />{item.master || "Не назначен"}</p>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-slate-400">
                      <span className="flex gap-1"><CalendarDays size={13} />{date(item.plannedStartAt)}</span>
                      <span>{date(item.plannedEndAt)}</span>
                    </div>
                    {item.actualEndAt && <p className="mt-1 text-xs text-emerald-400">Факт: {date(item.actualEndAt)}</p>}
                    {overdue && <p className="mt-2 flex gap-1 text-xs font-semibold text-red-400"><Clock3 size={14} />Просрочено</p>}
                    {item.comment && <p className="mt-2 rounded-lg bg-slate-800 p-2 text-xs text-slate-300">{item.comment}</p>}
                    <p className="mt-2 text-[11px] text-slate-500">Последний переход: {lastHistory ? `${lastHistory.fromStage ?? "Создание"} → ${lastHistory.toStage}` : "нет истории"}</p>
                    <details className="mt-2 text-xs text-slate-300">
                      <summary className="cursor-pointer text-blue-300">История ({item.stageHistory.length})</summary>
                      <div className="mt-2 space-y-2">
                        {item.stageHistory.map((history) => <div key={history.id} className="border-l border-slate-600 pl-2"><p>{history.fromStage ?? "Создание"} → {history.toStage}</p><p className="text-slate-500">{history.changedBy?.name ?? "Система"} · {date(history.createdAt)}</p>{history.comment && <p>{history.comment}</p>}</div>)}
                        {!item.stageHistory.length && <p className="text-slate-500">История пока пуста</p>}
                      </div>
                    </details>
                    {onEdit && <button type="button" disabled={saving} onClick={() => onEdit(item)} className="mt-3 w-full rounded-lg bg-slate-800 px-3 py-2 text-xs text-white hover:bg-slate-700 disabled:opacity-50">Редактировать</button>}
                    {!!allowedStages.length && <label className="mt-3 block text-xs font-medium text-slate-300 md:hidden">Переместить на этап
                      <select aria-label={`Переместить заказ ${item.order.number} на этап`} disabled={saving} value={item.stage} onChange={(event) => onDropCard(item.id, event.target.value as ProductionStage)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-600 bg-slate-800 px-3 text-sm text-white disabled:opacity-50">
                        <option value={currentStage}>{currentStage}</option>
                        {allowedStages.map((nextStage) => <option key={nextStage} value={nextStage}>{nextStage}</option>)}
                      </select>
                    </label>}
                  </article>
                );
              })}
              {!columns[stage].length && <p className="rounded-xl border border-dashed border-slate-700 py-7 text-center text-sm text-slate-500">Нет заказов</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
