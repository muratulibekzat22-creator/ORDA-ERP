"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  CalendarPlus,
  Clipboard,
  FileImage,
  MapPin,
  MessageCircle,
  MoreVertical,
  Phone,
  RotateCcw,
  XCircle,
} from "lucide-react";

type Measurement = {
  id: number;
  status: string;
  visitDate: string;
  city: string;
  address: string;
  mapLink?: string | null;
  stepsCount?: number | null;
  stepLength?: number | null;
  stepWidth?: number | null;
  riserHeight?: number | null;
  winderCount: number;
  platformsCount: number;
  railingLength?: number | null;
  individualSteps?: Array<{
    length: number;
    width: number;
    height?: number;
  }> | null;
  platforms?: Array<{ length: number; width: number }> | null;
  winders?: Array<{ length?: number; width?: number; comment?: string }> | null;
  objectNotes?: string | null;
  comment?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  clientOutcome?: "READY_TO_CONTINUE" | "RETURN_TO_MANAGER" | "REFUSED" | null;
  outcomeComment?: string | null;
  refusalReason?: string | null;
  outcomeAt?: string | null;
  measurerUser?: { id: number; name: string } | null;
  attachments: Array<{ id: number; type: string; fileName: string }>;
  auditEvents: Array<{ id: number; action: string; comment?: string | null; createdAt: string; actor?: { id: number; name: string } | null }>;
};
type Measurer = { id: number; name: string };

const input =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500";
const statusNames: Record<string, string> = {
  ASSIGNED: "Назначен",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершён",
  HANDED_TO_MANAGER: "Передан менеджеру",
  CANCELLED: "Отменён",
};
const outcomeNames: Record<string, string> = {
  READY_TO_CONTINUE: "Клиент готов продолжить",
  RETURN_TO_MANAGER: "Требуется работа менеджера",
  REFUSED: "Клиент отказался",
};
const refusalNames: Record<string, string> = {
  PRICE_TOO_HIGH: "Дорого",
  CHANGED_MIND: "Передумал",
  COMPARING: "Сравнивает предложения",
  NOT_READY: "Пока не готов",
  UNSUITABLE_SOLUTION: "Не подходит решение",
  NO_BUDGET: "Нет бюджета",
  NO_RESPONSE: "Не выходит на связь",
  OTHER: "Другое",
};

export default function LeadMeasurementPanel({
  clientId,
  clientName,
  initialCity,
  initialAddress,
  clientPhone,
  clientWhatsapp,
}: {
  clientId: number;
  clientName: string;
  initialCity: string;
  initialAddress: string;
  clientPhone: string;
  clientWhatsapp: string;
}) {
  const [items, setItems] = useState<Measurement[]>([]),
    [measurers, setMeasurers] = useState<Measurer[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [whatsappText, setWhatsappText] = useState(""),
    [scheduleOpen, setScheduleOpen] = useState(false),
    [measurersLoaded, setMeasurersLoaded] = useState(false);
  const [cancelId, setCancelId] = useState<number | null>(null),
    [cancelReason, setCancelReason] = useState(""),
    [cancelComment, setCancelComment] = useState(""),
    [rescheduleId, setRescheduleId] = useState<number | null>(null),
    [rescheduleDate, setRescheduleDate] = useState(""),
    [rescheduleMeasurerId, setRescheduleMeasurerId] = useState("");
  const [form, setForm] = useState({
    measurerUserId: "",
    visitDate: "",
    city: initialCity,
    address: initialAddress,
    mapLink: "",
    comment: "",
  });
  const [office, setOffice] = useState<
    Record<number, { dueAt: string; comment: string }>
  >({});
  const load = useCallback(async () => {
    const [list, meta] = await Promise.all([
      fetch(`/api/measurements?clientId=${clientId}`, { cache: "no-store" }),
      fetch("/api/measurements?meta=1", { cache: "no-store" }),
    ]);
    if (list.ok) setItems(await list.json());
    if (meta.ok) {
      const active = ((await meta.json()).measurers ?? []) as Measurer[];
      setMeasurers(active);
      setMeasurersLoaded(true);
      setForm((current) => ({
        ...current,
        measurerUserId: active.length === 1
          ? String(active[0].id)
          : active.some((row) => String(row.id) === current.measurerUserId) ? current.measurerUserId : "",
      }));
    } else {
      setMeasurersLoaded(true);
      setError("Не удалось загрузить активных замерщиков");
    }
  }, [clientId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash === "#measurement-scheduling") setScheduleOpen(true);
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, []);

  async function schedule() {
    setBusy(true);
    setError("");
    setNotice("");
    setWhatsappText("");
    const response = await fetch("/api/measurements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        clientId,
        measurerUserId: Number(form.measurerUserId),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось назначить замер");
    else {
      setNotice("Замер назначен и добавлен в календарь замерщика");
      setWhatsappText(body.whatsappText ?? "");
      setForm((value) => ({ ...value, visitDate: "", comment: "" }));
      setScheduleOpen(false);
      await load();
    }
    setBusy(false);
  }

  async function action(id: number, body: Record<string, unknown>, ok: string) {
    setBusy(true);
    setError("");
    setNotice("");
    const response = await fetch(`/api/measurements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok)
      setError(payload.error ?? "Не удалось выполнить действие");
    else {
      setNotice(ok);
      await load();
    }
    setBusy(false);
  }

  return (
    <section id="measurement-scheduling" className="scroll-mt-20 rounded-2xl border border-amber-700/50 bg-amber-950/10 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
        <CalendarPlus className="mt-1 shrink-0 text-amber-300" />
        <div>
          <h2 className="text-xl font-semibold text-white">Замеры</h2>
          <p className="mt-1 text-sm text-slate-400">
            Назначение создаёт задачу типа MEASUREMENT и не создаёт продажу или
            заказ.
          </p>
        </div>
        </div>
        <button type="button" onClick={() => setScheduleOpen((value) => !value)} className="min-h-11 rounded-xl bg-amber-500 px-4 font-semibold text-slate-950">
          + Назначить замер
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl bg-red-950/50 p-3 text-red-300"
        >
          {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="mt-4 rounded-xl bg-emerald-950/50 p-3 text-emerald-300"
        >
          {notice}
        </p>
      )}
      {scheduleOpen && <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-4 grid gap-2 rounded-xl bg-slate-900 p-3 text-sm text-slate-300 sm:grid-cols-3">
        <span><b className="block text-white">{clientName || "Имя не указано"}</b>Клиент</span>
        <span><b className="block text-white">{clientWhatsapp || clientPhone}</b>Телефон / WhatsApp</span>
        <span><b className="block text-white">{form.city || "Город не указан"}</b>Город</span>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {!measurersLoaded ? <p className="rounded-xl bg-slate-900 p-3 text-slate-400">Загрузка замерщиков…</p> : measurers.length === 0 ? <p role="alert" className="rounded-xl bg-red-950/50 p-3 text-red-300">Нет активного замерщика</p> : measurers.length === 1 ? <div className="text-sm text-slate-300">Замерщик<b className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">{measurers[0].name} · выбран автоматически</b></div> :
        <label className="text-sm text-slate-300">
          Замерщик
          <select
            className={`${input} mt-1`}
            value={form.measurerUserId}
            onChange={(event) =>
              setForm({ ...form, measurerUserId: event.target.value })
            }
          >
            <option value="">Выберите</option>
            {measurers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        }
        <label className="text-sm text-slate-300">
          Дата замера
          <input
            className={`${input} mt-1`}
            type="date"
            value={form.visitDate.split("T")[0] ?? ""}
            onChange={(event) =>
              setForm({ ...form, visitDate: event.target.value ? `${event.target.value}T${form.visitDate.split("T")[1] || "09:00"}` : "" })
            }
          />
        </label>
        <label className="text-sm text-slate-300">Время<input className={`${input} mt-1`} type="time" value={form.visitDate.split("T")[1] ?? ""} onChange={(event) => setForm({ ...form, visitDate: form.visitDate.split("T")[0] ? `${form.visitDate.split("T")[0]}T${event.target.value}` : "" })}/></label>
        <label className="text-sm text-slate-300">
          Город
          <input
            className={`${input} mt-1`}
            value={form.city}
            onChange={(event) => setForm({ ...form, city: event.target.value })}
          />
        </label>
        <label className="text-sm text-slate-300 md:col-span-2">
          Адрес
          <input
            className={`${input} mt-1`}
            value={form.address}
            onChange={(event) =>
              setForm({ ...form, address: event.target.value })
            }
          />
        </label>
        <label className="text-sm text-slate-300">
          Ссылка на локацию
          <input
            className={`${input} mt-1`}
            type="url"
            value={form.mapLink}
            onChange={(event) =>
              setForm({ ...form, mapLink: event.target.value })
            }
          />
        </label>
        <label className="text-sm text-slate-300 md:col-span-2 xl:col-span-3">
          Комментарий
          <input
            className={`${input} mt-1`}
            value={form.comment}
            onChange={(event) =>
              setForm({ ...form, comment: event.target.value })
            }
          />
        </label>
      </div>
      <button
        type="button"
        disabled={
          busy ||
          !form.measurerUserId ||
          !form.visitDate ||
          (!form.address.trim() && !form.mapLink.trim())
        }
        onClick={() => void schedule()}
        className="mt-4 min-h-12 w-full rounded-xl bg-amber-500 px-5 font-semibold text-slate-950 disabled:opacity-50 sm:w-auto"
      >
        Назначить замер
      </button>
      </div>}
      {whatsappText && (
        <div className="mt-4 rounded-xl border border-green-800 bg-green-950/20 p-4">
          <div className="flex items-center justify-between gap-3">
            <b className="text-green-200">Текст для общей WhatsApp-группы</b>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard
                  .writeText(whatsappText)
                  .then(() => setNotice("Текст скопирован"))
              }
              className="flex min-h-11 items-center gap-2 rounded-lg bg-green-700 px-3 text-sm"
            >
              <Clipboard size={16} />
              Копировать
            </button>
          </div>
          <pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-slate-200">
            {whatsappText}
          </pre>
          <p className="mt-2 text-xs text-slate-500">
            Система не сообщает об отправке: официальная интеграция группового
            WhatsApp не подключена.
          </p>
        </div>
      )}
      <div className="mt-6 space-y-3">
        {items.length ? (
          items.map((row) => (
            <article
              key={row.id}
              className="rounded-xl border border-slate-800 bg-slate-950/70 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <b className="text-white">
                    {new Intl.DateTimeFormat("ru-RU", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Almaty",
                    }).format(new Date(row.visitDate))}
                  </b>
                  <p className="mt-1 text-sm text-slate-400">
                    {row.measurerUser?.name} · {row.city} · {row.address}
                  </p>
                </div>
                <div className="flex items-start gap-2">
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
                    {statusNames[row.status] ?? row.status}
                  </span>
                  {["ASSIGNED", "IN_PROGRESS"].includes(row.status) && (
                    <details className="relative">
                      <summary aria-label={`Действия с замером №${row.id}`} className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg bg-slate-800 text-slate-200 [&::-webkit-details-marker]:hidden"><MoreVertical size={17} /></summary>
                      <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
                        <button type="button" onClick={() => { setCancelId(null); setRescheduleId(row.id); setRescheduleDate(new Date(row.visitDate).toISOString().slice(0, 16)); setRescheduleMeasurerId(row.measurerUser ? String(row.measurerUser.id) : ""); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-slate-800"><RotateCcw size={16} />Перенести</button>
                        <button type="button" onClick={() => { setRescheduleId(null); setCancelId(row.id); setCancelReason(""); setCancelComment(""); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-red-300 hover:bg-red-950/50"><XCircle size={16} />Отменить замер</button>
                      </div>
                    </details>
                  )}
                </div>
              </div>
              {rescheduleId === row.id && (
                <div className="mt-3 grid gap-3 rounded-xl border border-amber-800 bg-amber-950/20 p-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-300">Новая дата и время<input type="datetime-local" className={`${input} mt-1`} value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} /></label>
                  <label className="text-sm text-slate-300">Замерщик<select className={`${input} mt-1`} value={rescheduleMeasurerId} onChange={(event) => setRescheduleMeasurerId(event.target.value)}><option value="">Выберите</option>{measurers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                  <div className="flex gap-2 sm:col-span-2"><button type="button" onClick={() => setRescheduleId(null)} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-3">Отмена</button><button type="button" disabled={busy || !rescheduleDate || !rescheduleMeasurerId} onClick={() => void action(row.id, { action: "reschedule", visitDate: rescheduleDate, measurerUserId: Number(rescheduleMeasurerId), city: row.city, address: row.address, mapLink: row.mapLink }, "Замер перенесён").then(() => setRescheduleId(null))} className="min-h-11 flex-1 rounded-xl bg-amber-500 px-3 font-semibold text-slate-950 disabled:opacity-50">Сохранить</button></div>
                </div>
              )}
              {cancelId === row.id && (
                <div className="mt-3 space-y-3 rounded-xl border border-red-800 bg-red-950/20 p-3">
                  <label className="text-sm text-slate-300">Причина<input className={`${input} mt-1`} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label>
                  <label className="text-sm text-slate-300">Комментарий<textarea rows={2} className={`${input} mt-1`} value={cancelComment} onChange={(event) => setCancelComment(event.target.value)} /></label>
                  <div className="flex gap-2"><button type="button" onClick={() => setCancelId(null)} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-3">Не отменять</button><button type="button" disabled={busy || !cancelReason.trim()} onClick={() => void action(row.id, { action: "cancel", reason: cancelReason, comment: cancelComment }, "Замер отменён").then(() => setCancelId(null))} className="min-h-11 flex-1 rounded-xl bg-red-700 px-3 font-semibold disabled:opacity-50">Отменить замер</button></div>
                </div>
              )}
              {row.mapLink && (
                <a
                  href={row.mapLink}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-blue-300"
                >
                  <MapPin size={15} />
                  Открыть локацию
                </a>
              )}
              {["COMPLETED", "HANDED_TO_MANAGER"].includes(row.status) && (
                <div className="mt-4 grid gap-2 rounded-xl bg-slate-900 p-3 text-sm text-slate-300 sm:grid-cols-3">
                  <span>
                    Ступени: <b className="text-white">{row.stepsCount ?? 0}</b>
                  </span>
                  <span>
                    Размер:{" "}
                    <b className="text-white">
                      {row.stepLength ?? "—"} × {row.stepWidth ?? "—"}
                    </b>
                  </span>
                  <span>
                    Подступенок:{" "}
                    <b className="text-white">{row.riserHeight ?? "—"}</b>
                  </span>
                  <span>
                    Забежные: <b className="text-white">{row.winderCount}</b>
                  </span>
                  <span>
                    Площадки: <b className="text-white">{row.platformsCount}</b>
                  </span>
                  <span>
                    Перила:{" "}
                    <b className="text-white">{row.railingLength ?? 0} м</b>
                  </span>
                  <span className="sm:col-span-3">
                    Дата выполнения:{" "}
                    <b className="text-white">
                      {row.completedAt
                        ? new Intl.DateTimeFormat("ru-RU", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "Asia/Almaty",
                          }).format(new Date(row.completedAt))
                        : "—"}
                    </b>
                  </span>
                  {row.individualSteps?.length ? (
                    <span className="sm:col-span-3">
                      Ступени:{" "}
                      <b className="text-white">
                        {row.individualSteps
                          .map(
                            (item, index) =>
                              `№${index + 1}: ${item.length}×${item.width}${item.height ? `×${item.height}` : ""}`,
                          )
                          .join("; ")}
                      </b>
                    </span>
                  ) : null}
                  {row.platforms?.length ? (
                    <span className="sm:col-span-3">
                      Площадки:{" "}
                      <b className="text-white">
                        {row.platforms
                          .map(
                            (item, index) =>
                              `№${index + 1}: ${item.length}×${item.width}`,
                          )
                          .join("; ")}
                      </b>
                    </span>
                  ) : null}
                  {row.objectNotes && (
                    <span className="sm:col-span-3">
                      Особенности:{" "}
                      <b className="text-white">{row.objectNotes}</b>
                    </span>
                  )}
                  {row.comment && (
                    <span className="sm:col-span-3">
                      Комментарий замерщика:{" "}
                      <b className="text-white">{row.comment}</b>
                    </span>
                  )}
                  {row.clientOutcome && (
                    <span className="rounded-lg border border-emerald-900 bg-emerald-950/20 p-3 sm:col-span-3">
                      <b className="block text-white">Результат клиента: {outcomeNames[row.clientOutcome] ?? row.clientOutcome}</b>
                      {row.refusalReason && <span className="mt-1 block">Причина: {refusalNames[row.refusalReason] ?? row.refusalReason}</span>}
                      {row.outcomeComment && <span className="mt-1 block whitespace-pre-wrap">{row.outcomeComment}</span>}
                      {row.outcomeAt && <span className="mt-1 block text-xs text-slate-500">Зафиксировано {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(row.outcomeAt))}</span>}
                    </span>
                  )}
                  <span className="sm:col-span-3">
                    {row.attachments.map((photo) => (
                      <a
                        key={photo.id}
                        href={`/api/measurement-attachments/${photo.id}`}
                        target="_blank"
                        className="mr-3 inline-flex items-center gap-1 text-blue-300"
                      >
                        <FileImage size={15} />
                        {photo.type === "SHEET"
                          ? "Лист замера"
                          : photo.fileName}
                      </a>
                    ))}
                  </span>
                </div>
              )}
              {row.status === "CANCELLED" && (() => {
                const event = row.auditEvents.find((item) => item.action === "MEASUREMENT_CANCELLED" || item.action === "CANCELLED");
                return <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm text-slate-300"><b className="text-white">Замер отменён</b><p className="mt-1">{event?.comment || "Причина не указана"}</p>{event && <p className="mt-1 text-xs text-slate-500">{new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Almaty" }).format(new Date(event.createdAt))} · {event.actor?.name ?? "Система"}</p>}</div>;
              })()}
              {(row.status === "HANDED_TO_MANAGER" || (row.status === "COMPLETED" && row.clientOutcome && row.clientOutcome !== "REFUSED")) && (
                <div className="mt-4 grid gap-3">
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={`tel:${clientPhone}`}
                      className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-700 px-4 text-sm font-semibold"
                    >
                      <Phone size={16} />
                      Позвонить клиенту
                    </a>
                    <a
                      href={`https://wa.me/${(clientWhatsapp || clientPhone).replace(/\D/g, "")}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-11 items-center gap-2 rounded-xl bg-green-700 px-4 text-sm font-semibold"
                    >
                      <MessageCircle size={16} />
                      WhatsApp клиенту
                    </a>
                    <Link
                      href={`/measurements?measurement=${row.id}`}
                      className="flex min-h-11 items-center rounded-xl bg-slate-700 px-4 text-sm font-semibold"
                    >
                      Открыть полный замер
                    </Link>
                    {!row.clientOutcome && <button
                      disabled={busy}
                      onClick={() =>
                        void action(
                          row.id,
                          { action: "ready-contract" },
                          "Создана приоритетная задача менеджеру",
                        )
                      }
                      className="min-h-11 rounded-xl bg-emerald-700 px-4 text-sm font-semibold"
                    >
                      Клиент готов к договору
                    </button>}
                    <Link
                      href={`/clients/${clientId}/proposal`}
                      className="flex min-h-11 items-center rounded-xl bg-blue-700 px-4 text-sm font-semibold"
                    >
                      Использовать данные для расчёта / КП
                    </Link>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                    <input
                      type="datetime-local"
                      className={input}
                      value={office[row.id]?.dueAt ?? ""}
                      onChange={(event) =>
                        setOffice({
                          ...office,
                          [row.id]: {
                            dueAt: event.target.value,
                            comment: office[row.id]?.comment ?? "",
                          },
                        })
                      }
                    />
                    <input
                      className={input}
                      placeholder="Комментарий к встрече"
                      value={office[row.id]?.comment ?? ""}
                      onChange={(event) =>
                        setOffice({
                          ...office,
                          [row.id]: {
                            dueAt: office[row.id]?.dueAt ?? "",
                            comment: event.target.value,
                          },
                        })
                      }
                    />
                    <button
                      disabled={busy || !office[row.id]?.dueAt}
                      onClick={() =>
                        void action(
                          row.id,
                          { action: "invite-office", ...office[row.id] },
                          "Встреча добавлена в календарь",
                        )
                      }
                      className="min-h-11 rounded-xl bg-slate-700 px-4 text-sm disabled:opacity-50"
                    >
                      Пригласить в офис
                    </button>
                  </div>
                </div>
              )}
            </article>
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-slate-700 p-5 text-slate-400">
            Замеры ещё не назначены.
          </p>
        )}
      </div>
    </section>
  );
}
