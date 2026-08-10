"use client";

import { MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type OrderAction = {
  id: number;
  number: string;
  deletedAt?: string | Date | null;
  hasFinancialHistory?: boolean;
};

export default function OrderActionsMenu({
  order,
  canDelete,
  canRestore = false,
  onChanged,
}: {
  order: OrderAction;
  canDelete: boolean;
  canRestore?: boolean;
  onChanged?: (id: number) => void;
}) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function remove() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось удалить заказ");
      setDeleteOpen(false);
      onChanged?.(order.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось удалить заказ",
      );
    } finally {
      setSaving(false);
    }
  }

  async function restore() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${order.id}/restore`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось восстановить заказ");
      onChanged?.(order.id);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось восстановить заказ",
      );
    } finally {
      setSaving(false);
    }
  }

  if (!canDelete && !canRestore) return null;

  return (
    <>
      <details className="relative">
        <summary
          aria-label={`Действия с заказом ${order.number}`}
          className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 [&::-webkit-details-marker]:hidden"
        >
          <MoreVertical size={18} />
        </summary>
        <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-slate-700 bg-slate-950 p-2 text-left shadow-2xl">
          {!order.deletedAt && (
            <Link
              href={`/orders/${order.id}`}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-slate-200 hover:bg-slate-800"
            >
              <Pencil size={16} /> Редактировать
            </Link>
          )}
          {canRestore && order.deletedAt ? (
            <button
              type="button"
              disabled={saving}
              onClick={() => void restore()}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-50"
            >
              <RotateCcw size={16} /> Восстановить заказ
            </button>
          ) : canDelete ? (
            <button
              type="button"
              onClick={() => setDeleteOpen(true)}
              className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-sm text-red-300 hover:bg-red-950/40"
            >
              <Trash2 size={16} /> Удалить заказ
            </button>
          ) : null}
          {error && (
            <p role="alert" className="px-3 py-2 text-xs text-red-300">
              {error}
            </p>
          )}
        </div>
      </details>

      {deleteOpen && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-red-900 bg-slate-950 p-5 shadow-2xl">
            <h2 className="text-xl font-bold text-white">
              Удалить заказ из рабочего списка?
            </h2>
            <p className="mt-3 text-sm text-slate-300">
              Заказ перестанет отображаться в активной работе. Связанная история
              будет сохранена.
            </p>
            {order.hasFinancialHistory && (
              <p className="mt-3 rounded-xl border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">
                По заказу есть подтверждённые финансовые операции. Они будут
                сохранены.
              </p>
            )}
            <label className="mt-4 block text-sm text-slate-300">
              Причина (необязательно)
              <select
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                className="mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
              >
                <option value="">Не указывать</option>
                <option value="Создано ошибочно">Создано ошибочно</option>
                <option value="Дубликат">Дубликат</option>
                <option value="Клиент отказался">Клиент отказался</option>
                <option value="Другое">Другое</option>
              </select>
            </label>
            {error && (
              <p role="alert" className="mt-3 text-sm text-red-300">
                {error}
              </p>
            )}
            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => {
                  setDeleteOpen(false);
                  setError("");
                }}
                className="min-h-11 rounded-xl bg-slate-800 px-4 text-slate-200 disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void remove()}
                className="min-h-11 rounded-xl bg-red-700 px-4 font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {saving ? "Удаление…" : "Удалить заказ"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
