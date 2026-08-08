"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  ExternalLink,
  File,
  Loader2,
  MapPin,
  MessageCircle,
  Paperclip,
  Phone,
  Plus,
  Save,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";

type Interaction = {
  id: number;
  comment: string;
  authorName: string;
  createdAt: string;
};
type Attachment = {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
  uploadedBy?: { name: string } | null;
};
type Order = {
  id: number;
  number: string;
  address: string;
  material: string;
  amount: string;
  prepayment: string;
  balance: string;
  status: string;
  createdAt: string;
  payments: Array<{ amount: string }>;
};
type ClientDetail = {
  id: number;
  name: string;
  phone: string;
  whatsapp: string;
  city: string;
  address: string;
  source: string;
  manager: string;
  status: string;
  stage: string;
  lostReason?: string | null;
  nextActions: Array<{ id: number; nextActionType: string; nextActionAt: string; nextActionComment?: string | null; completedAt?: string | null; resultComment?: string | null }>;
  leadStatusHistory: Array<{ id: number; fromStage?: string | null; toStage?: string | null; authorName: string; comment?: string | null; createdAt: string }>;
  estimateNotes: string;
  estimatedAmount: string;
  createdAt: string;
  updatedAt: string;
  interactions: Interaction[];
  attachments: Attachment[];
  orders: Order[];
};

const inputClass =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20";
const money = (value: number) =>
  new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "KZT",
    maximumFractionDigits: 0,
  }).format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export default function ClientCard({ clientId }: { clientId: number }) {
  const [client, setClient] = useState<ClientDetail | null>(null),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [interaction, setInteraction] = useState(""),
    fileRef = useRef<HTMLInputElement>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/clients/${clientId}`, {
        cache: "no-store",
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось открыть клиента");
      setClient(payload);
    } catch (next) {
      setError(
        next instanceof Error ? next.message : "Не удалось открыть клиента",
      );
    } finally {
      setLoading(false);
    }
  }, [clientId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const flash = (message: string) => {
    setSuccess(message);
    window.setTimeout(() => setSuccess(""), 3500);
  };
  const update = (key: keyof ClientDetail, value: string) =>
    setClient((current) => (current ? { ...current, [key]: value } : current));
  async function save() {
    if (!client) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: client.name,
          phone: client.phone,
          whatsapp: client.whatsapp,
          city: client.city,
          address: client.address,
          source: client.source,
          estimateNotes: client.estimateNotes,
          estimatedAmount: client.estimatedAmount,
        }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сохранить карточку");
      flash("Карточка клиента сохранена");
      await load();
    } catch (next) {
      setError(
        next instanceof Error ? next.message : "Не удалось сохранить карточку",
      );
    } finally {
      setSaving(false);
    }
  }
  async function addInteraction() {
    const comment = interaction.trim();
    if (!comment) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/clients/${clientId}/interactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось добавить запись");
      setInteraction("");
      flash("Запись добавлена в историю");
      await load();
    } catch (next) {
      setError(
        next instanceof Error ? next.message : "Не удалось добавить запись",
      );
    } finally {
      setSaving(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const form = new FormData();
      form.set("clientId", String(clientId));
      form.set("file", file);
      const response = await fetch("/api/client-attachments", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось загрузить файл");
      flash("Файл прикреплён");
      await load();
    } catch (next) {
      setError(
        next instanceof Error ? next.message : "Не удалось загрузить файл",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setSaving(false);
    }
  }
  async function removeFile(id: number) {
    if (!window.confirm("Удалить прикреплённый файл?")) return;
    setSaving(true);
    const response = await fetch(`/api/client-attachments/${id}`, {
      method: "DELETE",
    });
    if (response.ok) {
      flash("Файл удалён");
      await load();
    } else
      setError(
        ((await response.json()) as { error?: string }).error ??
          "Не удалось удалить файл",
      );
    setSaving(false);
  }
  const finance = useMemo(() => {
    const orders = client?.orders ?? [];
    return {
      total: orders.reduce((s, o) => s + Number(o.amount), 0),
      received: orders.reduce(
        (s, o) => s + o.payments.reduce((p, x) => p + Number(x.amount), 0),
        0,
      ),
      balance: orders.reduce((s, o) => s + Number(o.balance), 0),
      count: orders.length,
    };
  }, [client]);
  if (loading)
    return (
      <main className="p-4 md:p-8" aria-live="polite">
        <div className="h-40 animate-pulse rounded-2xl bg-slate-900" />
        <div className="mt-5 grid gap-5 lg:grid-cols-3">
          <div className="h-96 animate-pulse rounded-2xl bg-slate-900 lg:col-span-2" />
          <div className="h-96 animate-pulse rounded-2xl bg-slate-900" />
        </div>
      </main>
    );
  if (!client)
    return (
      <main className="p-8">
        <Link href="/clients" className="text-blue-300">
          ← К списку заявок
        </Link>
        <p
          role="alert"
          className="mt-8 rounded-xl bg-red-950/40 p-5 text-red-300"
        >
          {error || "Заявка не найдена"}
        </p>
      </main>
    );
  return (
    <main className="space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/clients"
            className="inline-flex min-h-11 items-center gap-2 text-slate-300 hover:text-white"
          >
            <ArrowLeft size={18} />
            Все заявки
          </Link>
          <h1 className="mt-2 break-words text-3xl font-bold text-white">{client.name?.trim() && client.name !== client.phone ? client.name : client.phone}</h1>
          <p className="mt-1 text-slate-400">
            Заявка · создана {date(client.createdAt)}
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">
        <a href={`https://wa.me/${(client.whatsapp || client.phone).replace(/\D/g, "")}`} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-700 px-4 font-semibold text-white"><MessageCircle size={18}/>WhatsApp</a>
        <a href={`tel:${client.phone}`} className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4 text-white"><Phone size={18}/>Позвонить</a>
        <Link href={`/clients/${client.id}/proposal`} className="col-span-2 flex min-h-12 items-center justify-center rounded-xl bg-blue-600 px-5 font-semibold text-white">Рассчитать и сформировать КП</Link>
        <button
          onClick={() => void save()}
          disabled={saving}
          className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-700 px-5 font-semibold text-white disabled:opacity-60"
        >
          {saving ? (
            <Loader2 className="animate-spin" size={18} />
          ) : (
            <Save size={18} />
          )}
          Сохранить изменения
        </button></div>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300"
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          className="rounded-xl border border-green-800 bg-green-950/40 p-4 text-green-300"
        >
          {success}
        </p>
      )}
      <LeadWorkflow client={client} saving={saving} setSaving={setSaving} setError={setError} onSaved={load} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <div className="space-y-5">
          <Card title="Что нужно клиенту" icon={<UserRound size={20} />}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="ФИО">
                <input
                  value={client.name}
                  onChange={(e) => update("name", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Телефон">
                <input
                  type="tel"
                  inputMode="tel"
                  value={client.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="WhatsApp">
                <input
                  type="tel"
                  inputMode="tel"
                  value={client.whatsapp || client.phone}
                  onChange={(e) => update("whatsapp", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Город">
                <input
                  value={client.city}
                  onChange={(e) => update("city", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="Адрес">
                  <input
                    value={client.address}
                    onChange={(e) => update("address", e.target.value)}
                    className={inputClass}
                  />
                </Field>
              </div>
              <Field label="Источник заявки">
                <input
                  value={client.source}
                  onChange={(e) => update("source", e.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Менеджер">
                <input
                  value={client.manager}
                  disabled
                  className={inputClass}
                />
              </Field>
              <Field label="Статус">
                <input value={client.stage} disabled className={inputClass} />
              </Field>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <a
                href={`tel:${client.phone}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-white"
              >
                <Phone size={17} />
                Позвонить
              </a>
              <a
                href={`https://wa.me/${(client.whatsapp || client.phone).replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-green-700 px-4 text-white"
              >
                <MessageCircle size={17} />
                WhatsApp
              </a>
            </div>
          </Card>
          <Card title="Расчёт и КП" icon={<Save size={20} />}>
            <Field label="Ориентировочная сумма">
              <input
                type="number"
                inputMode="decimal"
                min="0"
                value={client.estimatedAmount}
                onChange={(e) => update("estimatedAmount", e.target.value)}
                className={inputClass}
              />
            </Field>
            <label className="mt-4 block text-sm text-slate-300">
              <span className="mb-2 block">Свободный расчёт и комментарии</span>
              <textarea
                rows={12}
                value={client.estimateNotes}
                onChange={(e) => update("estimateNotes", e.target.value)}
                className={inputClass}
                placeholder={
                  "Дуб ламель — 2 350 000\nКарагач — 2 150 000\nЛатунь\nПодсветка\nСтекло\nКомментарии"
                }
              />
            </label>
          </Card>
          <Card title="История общения" icon={<MessageCircle size={20} />}>
            <div className="flex flex-col gap-3 sm:flex-row">
              <textarea
                rows={3}
                value={interaction}
                onChange={(e) => setInteraction(e.target.value)}
                className={inputClass}
                placeholder="Позвонили, ждёт КП, напомнить завтра…"
              />
              <button
                onClick={() => void addInteraction()}
                disabled={saving || !interaction.trim()}
                className="min-h-11 shrink-0 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50"
              >
                <Plus size={17} className="inline" /> Добавить
              </button>
            </div>
            <div className="mt-5 space-y-3">
              {client.interactions.length ? (
                client.interactions.map((item) => (
                  <article
                    key={item.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
                  >
                    <p className="whitespace-pre-wrap text-slate-100">
                      {item.comment}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {item.authorName} · {date(item.createdAt)}
                    </p>
                  </article>
                ))
              ) : (
                <Empty text="История общения пока пуста. Добавьте первый результат звонка или встречи." />
              )}
            </div>
          </Card>
          <Card title="Прикреплённые файлы" icon={<Paperclip size={20} />}>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime,application/pdf,.doc,.docx,.xls,.xlsx"
              onChange={(e) => void upload(e.target.files?.[0])}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={saving}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-60"
            >
              <Upload size={18} />
              Загрузить файл
            </button>
            <p className="mt-2 text-xs text-slate-500">
              Фото, видео, PDF, Word и Excel до 50 МБ. Файлы хранятся в закрытом
              хранилище.
            </p>
            <div className="mt-4 space-y-3">
              {client.attachments.length ? (
                client.attachments.map((file) => (
                  <div
                    key={file.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <File className="shrink-0 text-blue-300" />
                      <div className="min-w-0">
                        <p className="truncate text-white">{file.fileName}</p>
                        <p className="text-xs text-slate-500">
                          {(file.size / 1024 / 1024).toFixed(1)} МБ ·{" "}
                          {date(file.createdAt)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <a
                        aria-label={`Открыть ${file.fileName}`}
                        target="_blank"
                        href={`/api/client-attachments/${file.id}`}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-slate-800 text-white"
                      >
                        <ExternalLink size={17} />
                      </a>
                      <a
                        aria-label={`Скачать ${file.fileName}`}
                        href={`/api/client-attachments/${file.id}?download=1`}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-slate-800 text-white"
                      >
                        <Download size={17} />
                      </a>
                      <button
                        aria-label={`Удалить ${file.fileName}`}
                        onClick={() => void removeFile(file.id)}
                        className="grid min-h-11 min-w-11 place-items-center rounded-lg bg-red-950 text-red-300"
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <Empty text="Файлы ещё не прикреплены." />
              )}
            </div>
          </Card>
          <Card title="Связанные заказы" icon={<CalendarDays size={20} />}>
            <div className="space-y-3">
              {client.orders.length ? (
                client.orders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className="block rounded-xl border border-slate-800 bg-slate-950/60 p-4 hover:border-blue-600"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-white">{order.number}</strong>
                      <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
                        {order.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-400">
                      {order.material} · {order.address}
                    </p>
                    <p className="mt-2 font-semibold text-green-300">
                      {money(Number(order.amount))}
                    </p>
                  </Link>
                ))
              ) : (
                <Empty text="У клиента пока нет заказов." />
              )}
            </div>
          </Card>
        </div>
        <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
          <Card title="Финансы клиента">
            <Metric
              label="Получено"
              value={money(finance.received)}
              tone="text-green-300"
            />
            <Metric
              label="Остаток"
              value={money(finance.balance)}
              tone="text-amber-300"
            />
            <Metric label="Количество заказов" value={String(finance.count)} />
            <Metric label="Общая сумма" value={money(finance.total)} />
          </Card>
          <Card title="Кратко">
            <Metric
              label="Первый заказ"
              value={
                client.orders.length
                  ? date(client.orders[client.orders.length - 1].createdAt)
                  : "—"
              }
            />
            <Metric
              label="Последний заказ"
              value={
                client.orders.length ? date(client.orders[0].createdAt) : "—"
              }
            />
            <Metric label="Менеджер" value={client.manager || "—"} />
            <Metric label="Статус" value={client.status} />
            <Metric
              label="Последняя активность"
              value={
                client.interactions[0]
                  ? date(client.interactions[0].createdAt)
                  : date(client.updatedAt)
              }
            />
          </Card>
          <Card title="Контакты">
            <p className="flex items-start gap-2 text-slate-300">
              <MapPin className="mt-0.5 shrink-0" size={17} />
              {client.city}
              {client.address ? `, ${client.address}` : ""}
            </p>
            <p className="mt-3 flex items-center gap-2 text-slate-300">
              <UserRound size={17} />
              {client.manager}
            </p>
          </Card>
        </aside>
      </div>
    </main>
  );
}
function Card({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 md:p-6">
      <h2 className="mb-5 flex items-center gap-2 text-xl font-semibold text-white">
        {icon}
        {title}
      </h2>
      {children}
    </section>
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
function Metric({
  label,
  value,
  tone = "text-white",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="border-b border-slate-800 py-3 last:border-0">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 break-words font-semibold ${tone}`}>{value}</p>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
      {text}
    </p>
  );
}

const stageOptions = ["NEW", "QUALIFIED", "CALCULATION_READY", "PROPOSAL_SENT", "FOLLOW_UP", "MEASUREMENT_SCHEDULED", "MEASUREMENT_COMPLETED", "NEGOTIATION", "WON", "LOST"];
const stageNames: Record<string, string> = { NEW: "Новое обращение", QUALIFIED: "Квалифицирован", CALCULATION_READY: "Расчёт готов", PROPOSAL_SENT: "КП отправлено", FOLLOW_UP: "Повторный контакт", MEASUREMENT_SCHEDULED: "Замер назначен", MEASUREMENT_COMPLETED: "Замер проведён", NEGOTIATION: "Согласование", WON: "Выиграно", LOST: "Проиграно" };
const actionOptions = [["CALL", "Позвонить"], ["WHATSAPP", "Написать WhatsApp"], ["FOLLOW_UP", "Повторный контакт"], ["MEASUREMENT", "Замер"], ["MEETING", "Встреча"], ["CALCULATION", "Подготовить расчёт"], ["PROPOSAL", "Отправить КП"], ["OTHER", "Другое"]];
const lostOptions = [["EXPENSIVE", "Дорого"], ["NO_RESPONSE", "Не отвечает"], ["COMPETITOR", "Выбрал конкурента"], ["POSTPONED", "Отложил"], ["NO_BUDGET", "Нет бюджета"], ["NOT_RELEVANT", "Неактуально"], ["LOCATION", "Регион/локация"], ["TIMING", "Не подходит срок"], ["OTHER", "Другое"]];

function LeadWorkflow({ client, saving, setSaving, setError, onSaved }: { client: ClientDetail; saving: boolean; setSaving: (value: boolean) => void; setError: (value: string) => void; onSaved: () => Promise<void> }) {
  const [stage, setStage] = useState(client.stage), [actionType, setActionType] = useState("CALL"), [actionAt, setActionAt] = useState(""), [comment, setComment] = useState(""), [lostReason, setLostReason] = useState(""), [lostComment, setLostComment] = useState("");
  const activeAction = client.nextActions.find((action) => !action.completedAt), closed = stage === "WON" || stage === "LOST", requiresAction = !closed && stage !== "NEW";
  async function changeStage() {
    setSaving(true); setError("");
    try {
      const response = await fetch(`/api/clients/${client.id}/stage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stage, comment, lostReason: stage === "LOST" ? lostReason : undefined, lostComment: stage === "LOST" ? lostComment : undefined, nextAction: requiresAction && !activeAction ? { type: actionType, at: actionAt, comment } : undefined }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Не удалось изменить стадию"); await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось изменить стадию"); } finally { setSaving(false); }
  }
  async function completeAction() {
    if (!activeAction) return; setSaving(true); setError("");
    try {
      const response = await fetch(`/api/clients/${client.id}/next-actions/${activeAction.id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resultComment: comment, nextAction: !closed ? { type: actionType, at: actionAt, comment } : undefined }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Не удалось завершить действие"); await onSaved();
    } catch (error) { setError(error instanceof Error ? error.message : "Не удалось завершить действие"); } finally { setSaving(false); }
  }
  return <section className="rounded-2xl border border-blue-800/60 bg-blue-950/20 p-4 md:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold text-white">Воронка продаж и следующее действие</h2><p className="mt-1 text-sm text-slate-400">Открытая заявка после первичной обработки всегда должна иметь запланированное действие.</p></div>{activeAction && <span className={`rounded-full px-3 py-1 text-sm ${new Date(activeAction.nextActionAt) < new Date() ? "bg-red-950 text-red-300" : "bg-blue-950 text-blue-300"}`}>{actionOptions.find(([value]) => value === activeAction.nextActionType)?.[1]} · {date(activeAction.nextActionAt)}</span>}</div><div className="mt-5 grid gap-3 md:grid-cols-3"><Field label="Стадия"><select value={stage} onChange={(event) => setStage(event.target.value)} className={inputClass}>{stageOptions.map((value) => <option key={value} value={value}>{stageNames[value]}</option>)}</select></Field>{stage === "LOST" && <Field label="Причина проигрыша"><select value={lostReason} onChange={(event) => setLostReason(event.target.value)} className={inputClass}><option value="">Выберите причину</option>{lostOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>}{stage === "LOST" && <Field label="Комментарий"><input value={lostComment} onChange={(event) => setLostComment(event.target.value)} className={inputClass} /></Field>}</div>{!closed && <div className="mt-4 grid gap-3 md:grid-cols-3"><Field label={activeAction ? "Следующее действие после выполнения" : "Следующее действие"}><select value={actionType} onChange={(event) => setActionType(event.target.value)} className={inputClass}>{actionOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Дата и время"><input type="datetime-local" value={actionAt} onChange={(event) => setActionAt(event.target.value)} className={inputClass} /></Field><Field label="Комментарий / результат"><input value={comment} onChange={(event) => setComment(event.target.value)} className={inputClass} /></Field></div>}<div className="mt-4 flex flex-wrap gap-3"><button onClick={() => void changeStage()} disabled={saving} className="min-h-11 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50">Сохранить стадию</button>{activeAction && <button onClick={() => void completeAction()} disabled={saving} className="flex min-h-11 items-center gap-2 rounded-xl bg-green-700 px-5 font-semibold text-white disabled:opacity-50"><CheckCircle2 size={18}/>Выполнено</button>}</div></section>;
}
