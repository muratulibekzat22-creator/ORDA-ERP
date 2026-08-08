"use client";
import { FormEvent, useEffect, useState } from "react";
import { X } from "lucide-react";

export type ClientDraft = {
  name: string;
  phone: string;
  city: string;
  managerUserId: string;
  estimateNotes: string;
};
type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (client: ClientDraft) => Promise<void>;
  saving?: boolean;
};
type Manager = { id: number; name: string };
const initial: ClientDraft = {
  name: "",
  phone: "+7",
  city: "Алматы",
  managerUserId: "",
  estimateNotes: "",
};

export default function ClientModal({
  open,
  onClose,
  onSave,
  saving = false,
}: Props) {
  const [form, setForm] = useState(initial),
    [managers, setManagers] = useState<Manager[]>([]),
    [fieldError, setFieldError] = useState("");
  useEffect(() => {
    if (!open) return;
    void fetch("/api/client-managers", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setManagers(payload.users);
        setForm((current) => ({
          ...current,
          managerUserId: current.managerUserId || String(payload.currentUserId),
        }));
      })
      .catch(() => setFieldError("Не удалось загрузить список менеджеров"));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) =>
      event.key === "Escape" && !saving && onClose();
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [onClose, open, saving]);
  if (!open) return null;
  const update = (key: keyof ClientDraft, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError("");
    if (form.phone.replace(/\D/g, "").length < 10)
      return setFieldError("Укажите корректный номер WhatsApp");
    if (!form.city.trim()) return setFieldError("Укажите город");
    if (!form.managerUserId)
      return setFieldError("Выберите ответственного менеджера");
    try {
      await onSave(form);
      setForm(initial);
    } catch {}
  }
  const input =
    "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500";
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-lead-title"
    >
      <form
        onSubmit={submit}
        className="max-h-[95vh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:max-w-xl sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-center justify-between">
          <div>
            <h2 id="new-lead-title" className="text-2xl font-bold text-white">
              Новая заявка
            </h2>
            <p className="mt-1 text-sm text-slate-400">
              Только данные, необходимые для начала работы
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 place-items-center rounded-xl text-slate-300"
            aria-label="Закрыть"
          >
            <X />
          </button>
        </div>
        {fieldError && (
          <p
            role="alert"
            className="mt-4 rounded-xl bg-red-950/50 p-3 text-sm text-red-300"
          >
            {fieldError}
          </p>
        )}
        <div className="mt-6 space-y-4">
          <Field label="Имя (необязательно)">
            <input
              autoFocus
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
              className={input}
            />
          </Field>
          <Field label="Номер WhatsApp">
            <input
              type="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(event) => update("phone", event.target.value)}
              className={input}
            />
          </Field>
          <Field label="Город">
            <input
              value={form.city}
              onChange={(event) => update("city", event.target.value)}
              className={input}
            />
          </Field>
          <Field label="Ответственный менеджер">
            <select
              value={form.managerUserId}
              onChange={(event) => update("managerUserId", event.target.value)}
              className={input}
            >
              <option value="">Выберите менеджера</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Комментарий (необязательно)">
            <textarea
              rows={4}
              value={form.estimateNotes}
              onChange={(event) => update("estimateNotes", event.target.value)}
              className={input}
            />
          </Field>
        </div>
        <button
          disabled={saving}
          className="mt-6 min-h-12 w-full rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Создаём…" : "Создать заявку"}
        </button>
      </form>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      {children}
    </label>
  );
}
