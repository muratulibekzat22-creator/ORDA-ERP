"use client";

import { useState } from "react";

import type { ProductionKanbanItem } from "./ProductionKanban";
import { PRODUCTION_STAGES, type ProductionStage } from "@/lib/production/stage-policy";

export type ProductionOptions = {
  orders: Array<{ id: number; number: string; address: string; material: string; client: { name: string } }>;
  assignees: Array<{ id: number; name: string; role: string }>;
};

export type ProductionEditorPayload = {
  orderId?: number;
  stage: ProductionStage;
  percent: number;
  masterUserId: number;
  priority: number;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  comment: string;
};

type Props = {
  item: ProductionKanbanItem | null;
  options: ProductionOptions;
  saving: boolean;
  onClose: () => void;
  onSave: (payload: ProductionEditorPayload) => Promise<void>;
};

const inputDate = (value: string | null) => value ? new Date(value).toISOString().slice(0, 10) : "";

export default function ProductionEditor({ item, options, saving, onClose, onSave }: Props) {
  const [orderId, setOrderId] = useState(item ? String(item.order.id) : "");
  const [stage, setStage] = useState<ProductionStage>((item?.stage as ProductionStage) ?? PRODUCTION_STAGES[0]);
  const [masterUserId, setMasterUserId] = useState(item?.masterUserId ? String(item.masterUserId) : "");
  const [priority, setPriority] = useState(String(item?.priority ?? 0));
  const [plannedStartAt, setPlannedStartAt] = useState(inputDate(item?.plannedStartAt ?? null));
  const [plannedEndAt, setPlannedEndAt] = useState(inputDate(item?.plannedEndAt ?? null));
  const [comment, setComment] = useState(item?.comment ?? "");
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    const parsedOrderId = Number(orderId);
    const parsedMaster = Number(masterUserId);
    const parsedPriority = Number(priority);
    if ((!item && (!Number.isInteger(parsedOrderId) || parsedOrderId <= 0)) || !Number.isInteger(parsedMaster) || parsedMaster <= 0 || !Number.isInteger(parsedPriority) || parsedPriority < 0 || parsedPriority > 999) {
      setError("Заполните заказ, ответственного и приоритет.");
      return;
    }
    if (plannedStartAt && plannedEndAt && plannedEndAt < plannedStartAt) {
      setError("Плановая дата окончания не может быть раньше даты начала.");
      return;
    }
    await onSave({
      ...(!item ? { orderId: parsedOrderId } : {}),
      stage,
      percent: item?.percent ?? 0,
      masterUserId: parsedMaster,
      priority: parsedPriority,
      plannedStartAt: plannedStartAt || null,
      plannedEndAt: plannedEndAt || null,
      comment,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-label={item ? "Редактирование производства" : "Создание производства"}>
      <form onSubmit={submit} className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#101827] p-6">
        <div className="flex items-center justify-between"><h2 className="text-xl font-bold text-white">{item ? `Редактирование ${item.order.number}` : "Новая production-запись"}</h2><button type="button" onClick={onClose} className="text-slate-400 hover:text-white">Закрыть</button></div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {!item && <label className="text-sm text-slate-300">Заказ<select aria-label="Заказ" value={orderId} onChange={(event) => setOrderId(event.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 p-3"><option value="">Выберите заказ</option>{options.orders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.client.name}</option>)}</select></label>}
          <label className="text-sm text-slate-300">Стадия<select aria-label="Стадия" value={stage} onChange={(event) => setStage(event.target.value as ProductionStage)} className="mt-1 w-full rounded-lg bg-slate-900 p-3">{PRODUCTION_STAGES.map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm text-slate-300">Ответственный<select aria-label="Ответственный" value={masterUserId} onChange={(event) => setMasterUserId(event.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 p-3"><option value="">Выберите сотрудника</option>{options.assignees.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.role}</option>)}</select></label>
          <label className="text-sm text-slate-300">Приоритет<input aria-label="Приоритет" type="number" min="0" max="999" value={priority} onChange={(event) => setPriority(event.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 p-3" /></label>
          <label className="text-sm text-slate-300">Плановое начало<input aria-label="Плановое начало" type="date" value={plannedStartAt} onChange={(event) => setPlannedStartAt(event.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 p-3" /></label>
          <label className="text-sm text-slate-300">Плановое окончание<input aria-label="Плановое окончание" type="date" value={plannedEndAt} onChange={(event) => setPlannedEndAt(event.target.value)} className="mt-1 w-full rounded-lg bg-slate-900 p-3" /></label>
          <label className="text-sm text-slate-300 md:col-span-2">Комментарий<textarea aria-label="Комментарий" value={comment} onChange={(event) => setComment(event.target.value)} className="mt-1 min-h-24 w-full rounded-lg bg-slate-900 p-3" /></label>
        </div>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-3"><button type="button" onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-white">Отмена</button><button disabled={saving} className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button></div>
      </form>
    </div>
  );
}
