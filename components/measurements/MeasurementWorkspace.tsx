"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import DirectorMeasurementControl from "@/components/measurements/DirectorMeasurementControl";
import {
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  MessageCircle,
  MoreVertical,
  Phone,
  Play,
  Plus,
  RotateCcw,
  Save,
  Upload,
  XCircle,
} from "lucide-react";

type Photo = {
  id: number;
  type: string;
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
};
type Measurement = {
  id: number;
  status: string;
  visitDate: string;
  city: string;
  address: string;
  mapLink?: string | null;
  managerComment?: string | null;
  stepsCount?: number | null;
  sameSize: boolean;
  stepLength?: number | null;
  stepWidth?: number | null;
  stepHeight?: number | null;
  individualSteps?: Array<{
    length?: number | null;
    width?: number | null;
    height?: number | null;
  }> | null;
  riserHeight?: number | null;
  winderCount: number;
  winders?: Array<{ length?: number; width?: number; comment?: string }> | null;
  platformsCount: number;
  platforms?: Array<{ length?: number | null; width?: number | null }> | null;
  railingLength?: number | null;
  railingComment?: string | null;
  objectNotes?: string | null;
  comment?: string | null;
  client: {
    id: number;
    name: string;
    phone: string;
    whatsapp: string;
    city: string;
    address: string;
    managerUser?: { id: number; name: string; phone?: string | null } | null;
  };
  measurerUser?: { id: number; name: string } | null;
  attachments: Photo[];
  order?: { id: number; number: string } | null;
  readyForContractAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  clientOutcome?: "READY_TO_CONTINUE" | "RETURN_TO_MANAGER" | "REFUSED" | null;
  outcomeComment?: string | null;
  refusalReason?: string | null;
  outcomeAt?: string | null;
  auditEvents: Array<{
    id: number;
    action: string;
    comment?: string | null;
    createdAt: string;
    actor?: { id: number; name: string } | null;
  }>;
};
type Payload = {
  measurements: Measurement[];
  pagination: { nextCursor: string | null; hasMore: boolean; limit: number; sort: "asc" | "desc" };
  kpi: {
    today: number;
    upcoming: number;
    overdue: number;
    handed: number;
    monthAssigned: number;
    monthCompleted: number;
    monthOrders: number;
    conversion: number;
    monthBonus: number;
    payable: number;
    bonusRate: number;
  };
  measurerStats: Array<{
    id: number;
    name: string;
    assigned: number;
    completed: number;
    orders: number;
    conversion: number;
    bonus: number;
  }>;
};
type ScheduleClient = { id: number; name: string; phone: string; whatsapp: string; city: string; address: string };
type ActiveMeasurer = { id: number; name: string };
type Form = {
  stepsCount: string;
  sameSize: boolean;
  stepLength: string;
  stepWidth: string;
  stepHeight: string;
  individualSteps: string;
  riserHeight: string;
  winderCount: string;
  winders: string;
  platformsCount: string;
  platforms: string;
  railingLength: string;
  railingComment: string;
  objectNotes: string;
  comment: string;
};

const input =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-blue-500";
const statusNames: Record<string, string> = {
  ASSIGNED: "Назначен",
  IN_PROGRESS: "В работе",
  COMPLETED: "Завершён",
  HANDED_TO_MANAGER: "Передан менеджеру",
  CANCELLED: "Отменён",
};
const statusTone: Record<string, string> = {
  ASSIGNED: "bg-blue-950 text-blue-200",
  IN_PROGRESS: "bg-amber-950 text-amber-200",
  COMPLETED: "bg-emerald-950 text-emerald-200",
  HANDED_TO_MANAGER: "bg-violet-950 text-violet-200",
  CANCELLED: "bg-slate-800 text-slate-300",
};
const outcomeNames: Record<string, string> = {
  READY_TO_CONTINUE: "Клиент готов продолжить",
  RETURN_TO_MANAGER: "Вернуть менеджеру",
  REFUSED: "Клиент отказался",
};
const refusalReasons: Array<[string, string]> = [
  ["PRICE_TOO_HIGH", "Дорого"],
  ["CHANGED_MIND", "Передумал"],
  ["COMPARING", "Сравнивает предложения"],
  ["NOT_READY", "Пока не готов"],
  ["UNSUITABLE_SOLUTION", "Не подходит решение"],
  ["NO_BUDGET", "Нет бюджета"],
  ["NO_RESPONSE", "Не выходит на связь"],
  ["OTHER", "Другое"],
];
const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;
const when = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const time = (value: string) =>
  new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Asia/Almaty",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const empty = (): Form => ({
  stepsCount: "",
  sameSize: true,
  stepLength: "",
  stepWidth: "",
  stepHeight: "",
  individualSteps: "",
  riserHeight: "",
  winderCount: "0",
  winders: "",
  platformsCount: "0",
  platforms: "",
  railingLength: "",
  railingComment: "",
  objectNotes: "",
  comment: "",
});
const formOf = (row: Measurement): Form => ({
  stepsCount: String(row.stepsCount ?? ""),
  sameSize: row.sameSize,
  stepLength: String(row.stepLength ?? ""),
  stepWidth: String(row.stepWidth ?? ""),
  stepHeight: String(row.stepHeight ?? ""),
  individualSteps:
    row.individualSteps
      ?.map(
        (item) =>
          `${item.length ?? ""} x ${item.width ?? ""}${item.height ? ` x ${item.height}` : ""}`,
      )
      .join("\n") ?? "",
  riserHeight: String(row.riserHeight ?? ""),
  winderCount: String(row.winderCount ?? 0),
  winders:
    row.winders
      ?.map(
        (item) =>
          `${item.length ?? ""} x ${item.width ?? ""}${item.comment ? ` — ${item.comment}` : ""}`,
      )
      .join("\n") ?? "",
  platformsCount: String(row.platformsCount ?? 0),
  platforms:
    row.platforms?.map((item) => `${item.length ?? ""} x ${item.width ?? ""}`).join("\n") ??
    "",
  railingLength: String(row.railingLength ?? ""),
  railingComment: row.railingComment ?? "",
  objectNotes: row.objectNotes ?? "",
  comment: row.comment ?? "",
});

function dimensions(value: string, withComment = false) {
  const number = (part: string | undefined) => {
    if (!part?.trim()) return undefined;
    const parsed = Number(part);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [size, note] = line.split(/\s+[—-]\s+/, 2),
        numbers = size.split(/[xх×]/i);
      return {
        length: number(numbers[0]),
        width: number(numbers[1]),
        ...(number(numbers[2]) ? { height: number(numbers[2]) } : {}),
        ...(withComment && note ? { comment: note } : {}),
      };
    });
}

export default function MeasurementWorkspace() {
  const { data: session } = useSession();
  if (session?.user.role === "DIRECTOR") return <DirectorMeasurementControl />;
  return <OperationalMeasurementWorkspace />;
}

function OperationalMeasurementWorkspace() {
  const { data: session } = useSession();
  const [data, setData] = useState<Payload>({
    measurements: [],
    pagination: { nextCursor: null, hasMore: false, limit: 30, sort: "asc" },
    kpi: {
      today: 0,
      upcoming: 0,
      overdue: 0,
      handed: 0,
      monthAssigned: 0,
      monthCompleted: 0,
      monthOrders: 0,
      conversion: 0,
      monthBonus: 0,
      payable: 0,
      bonusRate: 20_000,
    },
    measurerStats: [],
  });
  const [tab, setTab] = useState<
      "today" | "upcoming" | "completed" | "overdue" | "cancelled" | "all"
    >("today"),
    [selectedId, setSelectedId] = useState<number | null>(null),
    [form, setForm] = useState<Form>(empty()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [trainingRequired, setTrainingRequired] = useState(false),
    [notice, setNotice] = useState("");
  const [search, setSearch] = useState(""), [debouncedSearch, setDebouncedSearch] = useState("");
  const [inviteAt, setInviteAt] = useState(""),
    [inviteComment, setInviteComment] = useState("");
  const [clientOutcome, setClientOutcome] = useState<"" | "READY_TO_CONTINUE" | "RETURN_TO_MANAGER" | "REFUSED">(""),
    [outcomeComment, setOutcomeComment] = useState(""),
    [refusalReason, setRefusalReason] = useState(""),
    [cancelOpen, setCancelOpen] = useState(false),
    [cancelReason, setCancelReason] = useState(""),
    [cancelComment, setCancelComment] = useState(""),
    [rescheduleOpen, setRescheduleOpen] = useState(false),
    [rescheduleDate, setRescheduleDate] = useState(""),
    [rescheduleMeasurerId, setRescheduleMeasurerId] = useState("");
  const [creating, setCreating] = useState(false), [createOpen, setCreateOpen] = useState(false),
    [createForm, setCreateForm] = useState({ clientName: "", phone: "", city: "", visitDate: "", address: "", mapLink: "", comment: "" });
  const [scheduleOpen, setScheduleOpen] = useState(false),
    [scheduleClients, setScheduleClients] = useState<ScheduleClient[]>([]),
    [scheduleMeasurers, setScheduleMeasurers] = useState<ActiveMeasurer[]>([]),
    [whatsappText, setWhatsappText] = useState(""),
    [scheduleForm, setScheduleForm] = useState({ clientId: "", measurerUserId: "", visitDate: "", city: "", address: "", mapLink: "", comment: "" });
  const photoRef = useRef<HTMLInputElement>(null),
    [photoType, setPhotoType] = useState("SHEET");
  const measurer = session?.user.role === "MEASURER";
  const canSchedule = session?.user.role === "MANAGER";
  const canCloseOutcome = canSchedule || measurer;
  const selectMeasurement = (row: Measurement) => {
    setSelectedId(row.id);
    setForm(formOf(row));
    setClientOutcome(row.clientOutcome ?? "");
    setOutcomeComment(row.outcomeComment ?? "");
    setRefusalReason(row.refusalReason ?? "");
    setCancelOpen(false);
    setRescheduleOpen(false);
    setRescheduleDate(new Date(row.visitDate).toISOString().slice(0, 16));
    setRescheduleMeasurerId(row.measurerUser ? String(row.measurerUser.id) : "");
  };
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const load = useCallback(async (cursor?: string) => {
    const backendFilter = tab === "overdue" ? "needs-closing" : tab;
    const params = new URLSearchParams({ workspace: "1", filter: backendFilter, limit: "30" });
    if (debouncedSearch) params.set("search", debouncedSearch);
    if (cursor) params.set("cursor", cursor);
    const response = await fetch(`/api/measurements?${params}`, {
        cache: "no-store",
      }),
      body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось загрузить замеры");
    else {
      setData((current) => cursor ? {
        ...body,
        measurements: [...current.measurements, ...(body.measurements ?? [])].filter(
          (row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index,
        ),
      } : body);
      const requestedFilter = new URLSearchParams(window.location.search).get("filter");
      if (requestedFilter === "needs-closing") setTab("overdue");
      const requested = Number(
        new URLSearchParams(window.location.search).get("measurement"),
      );
      const requestedMeasurement = body.measurements?.find(
        (row: Measurement) => row.id === requested,
      );
      if (requestedMeasurement) {
        setSelectedId(requested);
        setForm(formOf(requestedMeasurement));
        setClientOutcome(requestedMeasurement.clientOutcome ?? "");
        setOutcomeComment(requestedMeasurement.outcomeComment ?? "");
        setRefusalReason(requestedMeasurement.refusalReason ?? "");
      } else if (!cursor && Number.isInteger(requested) && requested > 0) {
        const detailResponse = await fetch(`/api/measurements/${requested}`, { cache: "no-store" });
        if (detailResponse.ok) {
          const detail = await detailResponse.json() as Measurement;
          setData((current) => ({ ...current, measurements: [detail, ...current.measurements.filter((row) => row.id !== detail.id)] }));
          setSelectedId(detail.id);
          setForm(formOf(detail));
          setClientOutcome(detail.clientOutcome ?? "");
          setOutcomeComment(detail.outcomeComment ?? "");
          setRefusalReason(detail.refusalReason ?? "");
        }
      }
    }
  }, [debouncedSearch, tab]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const selected =
    data.measurements.find((row) => row.id === selectedId) ?? null;
  const rows = data.measurements;
  const patchForm = (key: keyof Form, value: string | boolean) =>
    setForm((current) => ({ ...current, [key]: value }));
  const payload = (action: string) => ({
    action,
    stepsCount: Number(form.stepsCount || 0),
    sameSize: form.sameSize,
    stepLength: form.stepLength ? Number(form.stepLength) : undefined,
    stepWidth: form.stepWidth ? Number(form.stepWidth) : undefined,
    stepHeight: form.stepHeight ? Number(form.stepHeight) : undefined,
    individualSteps: dimensions(form.individualSteps),
    riserHeight: form.riserHeight ? Number(form.riserHeight) : undefined,
    winderCount: Number(form.winderCount || 0),
    winders: dimensions(form.winders, true),
    platformsCount: Number(form.platformsCount || 0),
    platforms: dimensions(form.platforms),
    railingLength: form.railingLength ? Number(form.railingLength) : undefined,
    railingComment: form.railingComment,
    objectNotes: form.objectNotes,
    comment: form.comment,
  });
  async function run(body: Record<string, unknown>, ok: string) {
    if (!selected) return;
    setBusy(true);
    setError("");
    setTrainingRequired(false);
    setNotice("");
    try {
      const response = await fetch(`/api/measurements/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Не удалось выполнить действие");
        setTrainingRequired(result.code === "TRAINING_REQUIRED");
      } else {
        setNotice(ok);
        await load();
      }
    } catch {
      setError("Нет связи с сервером. Проверьте интернет и повторите сохранение — введённые данные остаются в форме.");
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    if (!clientOutcome) {
      setError("Выберите результат общения с клиентом");
      return;
    }
    if (clientOutcome === "RETURN_TO_MANAGER" && !outcomeComment.trim()) {
      setError("Для передачи менеджеру укажите комментарий");
      return;
    }
    if (clientOutcome === "REFUSED" && (!refusalReason || (refusalReason === "OTHER" && !outcomeComment.trim()))) {
      setError("Укажите причину отказа и комментарий для варианта «Другое»");
      return;
    }
    await run(
      { ...payload("complete"), clientOutcome, refusalReason: clientOutcome === "REFUSED" ? refusalReason : undefined, outcomeComment },
      "Замер завершён, результат передан менеджеру",
    );
  }
  async function upload(file?: File) {
    if (!selected || !file) return;
    setBusy(true);
    setError("");
    const body = new FormData();
    body.set("file", file);
    body.set("type", photoType);
    const response = await fetch(
        `/api/measurements/${selected.id}/attachments`,
        { method: "POST", body },
      ),
      result = await response.json().catch(() => ({}));
    if (!response.ok) setError(result.error ?? "Не удалось загрузить фото");
    else {
      setNotice("Фото сохранено в замере");
      await load();
    }
    if (photoRef.current) photoRef.current.value = "";
    setBusy(false);
  }
  function choosePhoto(type: "SHEET" | "OBJECT" | "EXTRA") {
    setPhotoType(type);
    window.setTimeout(() => photoRef.current?.click(), 0);
  }
  async function createOwnMeasurement(event: React.FormEvent) {
    event.preventDefault(); setCreating(true); setError("");
    const response = await fetch("/api/measurements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(createForm) }), body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось создать замер");
    else { setNotice(body.existingClient ? "Клиент уже существует — новый замер привязан к нему" : "Новый клиент и замер созданы"); setCreateOpen(false); setCreateForm({ clientName: "", phone: "", city: "", visitDate: "", address: "", mapLink: "", comment: "" }); await load(); }
    setCreating(false);
  }
  async function openSchedule() {
    const next = !scheduleOpen;
    if (!next) return setScheduleOpen(false);
    if (scheduleClients.length || scheduleMeasurers.length) return setScheduleOpen(true);
    setError("");
    const [clientsResponse, metaResponse] = await Promise.all([
      fetch("/api/clients?active=true&limit=100", { cache: "no-store" }),
      fetch("/api/measurements?meta=1", { cache: "no-store" }),
    ]);
    const clientsBody = await clientsResponse.json().catch(() => ({}));
    const metaBody = await metaResponse.json().catch(() => ({}));
    if (!clientsResponse.ok || !metaResponse.ok) return setError(clientsBody.error ?? metaBody.error ?? "Не удалось загрузить форму назначения");
    const clients = (clientsBody.data ?? []) as ScheduleClient[], active = (metaBody.measurers ?? []) as ActiveMeasurer[];
    setScheduleClients(clients); setScheduleMeasurers(active);
    const first = clients[0];
    setScheduleForm((current) => ({ ...current, clientId: first ? String(first.id) : "", city: first?.city ?? "", address: first?.address ?? "", measurerUserId: active.length === 1 ? String(active[0].id) : "" }));
    setScheduleOpen(true);
  }
  async function openReschedule() {
    setCancelOpen(false);
    setRescheduleOpen(true);
    if (measurer) {
      setRescheduleMeasurerId(selected?.measurerUser ? String(selected.measurerUser.id) : "");
      return;
    }
    if (scheduleMeasurers.length) return;
    const response = await fetch("/api/measurements?meta=1", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось загрузить замерщиков");
    else setScheduleMeasurers((body.measurers ?? []) as ActiveMeasurer[]);
  }
  function chooseScheduleClient(clientId: string) {
    const client = scheduleClients.find((row) => String(row.id) === clientId);
    setScheduleForm((current) => ({ ...current, clientId, city: client?.city ?? "", address: client?.address ?? "" }));
  }
  async function scheduleMeasurement(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setWhatsappText("");
    const response = await fetch("/api/measurements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scheduleForm, clientId: Number(scheduleForm.clientId), measurerUserId: Number(scheduleForm.measurerUserId) }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось назначить замер");
    else { setNotice("Замер назначен и появился в календаре замерщика"); setWhatsappText(body.whatsappText ?? ""); setScheduleOpen(false); await load(); }
    setBusy(false);
  }
  return (
    <main className="space-y-5 p-4 pb-24 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">
            {measurer ? "Кабинет замерщика" : "Замеры клиентов"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Расписание, фактические размеры и передача результата менеджеру
          </p>
        </div>
        {measurer && (<div className="flex flex-wrap gap-2"><button type="button" onClick={() => setCreateOpen((value) => !value)} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-semibold"><Plus size={17}/>Новый замер</button><Link
            href="/payroll"
            className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm text-white"
          >
            <Banknote size={17} />
            Моя зарплата
          </Link></div>)}
        {canSchedule && <button type="button" onClick={() => void openSchedule()} className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950"><Plus size={17}/>Назначить замер</button>}
      </header>
      {canSchedule && scheduleOpen && <form onSubmit={scheduleMeasurement} className="grid gap-3 rounded-2xl border border-amber-800 bg-[#101827] p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h2 className="text-lg font-semibold text-white sm:col-span-2 lg:col-span-3">Назначить замер по заявке</h2>
        <Field label="Клиент / заявка"><select required className={input} value={scheduleForm.clientId} onChange={(event) => chooseScheduleClient(event.target.value)}><option value="">Выберите заявку</option>{scheduleClients.map((client) => <option key={client.id} value={client.id}>{client.name || "Без имени"} · {client.phone}</option>)}</select></Field>
        {scheduleMeasurers.length === 0 ? <p role="alert" className="rounded-xl bg-red-950/50 p-3 text-red-300">Нет активного замерщика</p> : scheduleMeasurers.length === 1 ? <div className="text-sm text-slate-300">Замерщик<b className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">{scheduleMeasurers[0].name} · выбран автоматически</b></div> : <Field label="Замерщик"><select required className={input} value={scheduleForm.measurerUserId} onChange={(event) => setScheduleForm({...scheduleForm, measurerUserId:event.target.value})}><option value="">Выберите</option>{scheduleMeasurers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
        <Field label="Дата замера"><input required type="date" className={input} value={scheduleForm.visitDate.split("T")[0] ?? ""} onChange={(event) => setScheduleForm({...scheduleForm,visitDate:event.target.value ? `${event.target.value}T${scheduleForm.visitDate.split("T")[1] || "09:00"}` : ""})}/></Field>
        <Field label="Время"><input required type="time" className={input} value={scheduleForm.visitDate.split("T")[1] ?? ""} onChange={(event) => setScheduleForm({...scheduleForm,visitDate:scheduleForm.visitDate.split("T")[0] ? `${scheduleForm.visitDate.split("T")[0]}T${event.target.value}` : ""})}/></Field>
        <Field label="Город"><input className={input} value={scheduleForm.city} onChange={(event) => setScheduleForm({...scheduleForm,city:event.target.value})}/></Field>
        <Field label="Адрес"><input className={input} value={scheduleForm.address} onChange={(event) => setScheduleForm({...scheduleForm,address:event.target.value})}/></Field>
        <Field label="Ссылка на карту"><input type="url" className={input} value={scheduleForm.mapLink} onChange={(event) => setScheduleForm({...scheduleForm,mapLink:event.target.value})}/></Field>
        <Field label="Комментарий менеджера"><input className={input} value={scheduleForm.comment} onChange={(event) => setScheduleForm({...scheduleForm,comment:event.target.value})}/></Field>
        <button disabled={busy || !scheduleForm.clientId || !scheduleForm.measurerUserId || !scheduleForm.visitDate || (!scheduleForm.address.trim() && !scheduleForm.mapLink.trim())} className="min-h-12 rounded-xl bg-amber-500 px-4 font-semibold text-slate-950 disabled:opacity-50 sm:col-span-2 lg:col-span-3">Назначить замер</button>
      </form>}
      {whatsappText && <section className="rounded-2xl border border-green-900 bg-green-950/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><b className="text-green-200">WhatsApp-текст (копирование)</b><button type="button" onClick={() => void navigator.clipboard.writeText(whatsappText).then(() => setNotice("Текст скопирован"))} className="min-h-11 rounded-xl bg-green-700 px-4 text-sm font-semibold">Копировать</button></div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-slate-200">{whatsappText}</pre></section>}
      {measurer && createOpen && <form onSubmit={createOwnMeasurement} className="grid gap-3 rounded-2xl border border-blue-900 bg-[#101827] p-4 sm:grid-cols-2">
        <h2 className="text-lg font-semibold text-white sm:col-span-2">Новый замер</h2>
        {([ ["clientName", "Имя клиента (необязательно)", "text"], ["phone", "Телефон / WhatsApp", "tel"], ["city", "Город", "text"], ["visitDate", "Дата и время", "datetime-local"], ["address", "Адрес", "text"], ["mapLink", "Ссылка на карту (необязательно)", "url"], ["comment", "Комментарий", "text"] ] as const).map(([key,label,type]) => <Field key={key} label={label}><input required={["phone","city","visitDate","address"].includes(key)} type={type} className={input} value={createForm[key]} onChange={(event) => setCreateForm({...createForm,[key]:event.target.value})}/></Field>)}
        <button disabled={creating} className="min-h-12 rounded-xl bg-emerald-700 px-4 font-semibold sm:col-span-2">{creating ? "Создание…" : "Создать замер"}</button>
      </form>}
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300"
        >
          <p>{error}</p>
          {trainingRequired && (
            <Link
              href="/training"
              className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-4 font-semibold text-white"
            >
              Перейти к обучению
            </Link>
          )}
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-4 text-emerald-300"
        >
          {notice}
        </p>
      )}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi title="Сегодня" value={data.kpi.today} />
        <Kpi title="Предстоящие" value={data.kpi.upcoming} />
        <Kpi title="Требуют закрытия" value={data.kpi.overdue} alert />
        <Kpi title="Передано за месяц" value={data.kpi.handed} />
      </section>
      {measurer && (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <Kpi title="Назначено за месяц" value={data.kpi.monthAssigned} />
          <Kpi title="Выполнено за месяц" value={data.kpi.monthCompleted} />
          <Kpi title="Заказов после замера" value={data.kpi.monthOrders} />
          <Kpi title="Конверсия в заказ" value={`${data.kpi.conversion}%`} />
          <Kpi title="Бонусы за заказы" value={money(data.kpi.monthBonus)} />
          <Kpi title="К выплате" value={money(data.kpi.payable)} />
        </section>
      )}
      {data.measurerStats.length > 0 && (
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4">
          <h2 className="text-lg font-semibold text-white">
            Показатели замерщиков за месяц
          </h2>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {data.measurerStats.map((row) => (
              <article
                key={row.id}
                className="rounded-xl border border-slate-700 bg-slate-950/60 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <b className="text-white">{row.name}</b>
                  <span className="text-emerald-300">{row.conversion}%</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-slate-400">
                  <span>
                    Назначено <b className="block text-white">{row.assigned}</b>
                  </span>
                  <span>
                    Выполнено{" "}
                    <b className="block text-white">{row.completed}</b>
                  </span>
                  <span>
                    Заказов <b className="block text-white">{row.orders}</b>
                  </span>
                  <span>
                    Бонусов{" "}
                    <b className="block text-white">{money(row.bonus)}</b>
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.5fr)]">
        <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {(
              [
                ["today", "Сегодня"],
                ["upcoming", "Предстоящие"],
                ["completed", "Завершённые"],
                ["overdue", "Требуют закрытия"],
                ["cancelled", "Отменённые"],
                ["all", "Все"],
              ] as const
            ).map(([value, title]) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={`min-h-11 rounded-xl px-2 text-sm ${tab === value ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}
              >
                {title}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Клиент, телефон или город"
            className={`${input} mt-3`}
          />
          <div className="mt-4 space-y-3">
            {rows.length ? (
              rows.map((row) => (
                <article
                  key={row.id}
                  className={`rounded-xl border p-4 ${selectedId === row.id ? "border-blue-500 bg-blue-950/30" : "border-slate-800 bg-slate-950/60"}`}
                >
                  <button
                    onClick={() => selectMeasurement(row)}
                    className="w-full text-left"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block text-xs text-slate-400">
                          {new Intl.DateTimeFormat("ru-RU", {
                            timeZone: "Asia/Almaty",
                            dateStyle: "medium",
                          }).format(new Date(row.visitDate))}
                        </span>
                        <span className="text-lg font-bold text-white">
                          {time(row.visitDate)}
                        </span>
                      </span>
                      <span
                        className={`rounded-full px-2 py-1 text-xs ${statusTone[row.status]}`}
                      >
                        {statusNames[row.status]}
                      </span>
                    </div>
                    <b className="mt-2 block break-words text-slate-100">
                      {row.client.name}
                    </b>
                    <span className="mt-1 block text-sm text-slate-300">
                      {row.client.phone}
                    </span>
                    <span className="mt-1 block text-sm text-slate-400">
                      {row.city} · {row.address || "Локация по ссылке"}
                    </span>
                    <span className="mt-2 block text-xs text-slate-500">
                      Назначил:{" "}
                      {row.client.managerUser?.name ?? "менеджер не указан"}
                    </span>
                    <span className="mt-3 block text-sm font-semibold text-blue-300">
                      Открыть замер →
                    </span>
                  </button>
                  {(row.mapLink || row.address) && (
                    <a
                      href={
                        row.mapLink ||
                        `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${row.city} ${row.address}`)}`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-800 px-3 text-sm text-blue-200"
                    >
                      <MapPin size={16} />
                      Карта
                    </a>
                  )}
                </article>
              ))
            ) : (
              <p className="rounded-xl border border-dashed border-slate-700 p-5 text-center text-slate-400">
                Замеров в этой группе нет.
              </p>
            )}
            {data.pagination.hasMore && data.pagination.nextCursor && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void load(data.pagination.nextCursor ?? undefined)}
                className="min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900 px-4 font-semibold text-white disabled:opacity-50"
              >
                Загрузить ещё
              </button>
            )}
          </div>
        </section>
        {!selected ? (
          <section className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-slate-700 p-6 text-center text-slate-400">
            Выберите замер в расписании.
          </section>
        ) : (
          <section className="space-y-5 rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm text-blue-300">
                  Замер №{selected.id} · {when(selected.visitDate)}
                </p>
                <h2 className="mt-1 text-2xl font-bold text-white">
                  {selected.client.name}
                </h2>
                <p className="mt-1 text-slate-400">
                  {selected.city} · {selected.address}
                </p>
              </div>
              <div className="flex items-start gap-2">
                <span className={`rounded-full px-3 py-1 text-sm ${statusTone[selected.status]}`}>
                  {statusNames[selected.status]}
                </span>
                {canCloseOutcome && ["ASSIGNED", "IN_PROGRESS"].includes(selected.status) && (
                  <details className="relative">
                    <summary aria-label="Действия с замером" className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-lg bg-slate-800 text-slate-200 [&::-webkit-details-marker]:hidden">
                      <MoreVertical size={18} />
                    </summary>
                    <div className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-slate-700 bg-slate-950 p-2 shadow-2xl">
                      <button type="button" onClick={() => void openReschedule()} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-slate-200 hover:bg-slate-800">
                        <RotateCcw size={16} /> Перенести замер
                      </button>
                      <button type="button" onClick={() => { setCancelOpen(true); setRescheduleOpen(false); }} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-3 text-left text-sm text-red-300 hover:bg-red-950/50">
                        <XCircle size={16} /> Отменить замер
                      </button>
                    </div>
                  </details>
                )}
              </div>
            </div>
            {canCloseOutcome && rescheduleOpen && ["ASSIGNED", "IN_PROGRESS"].includes(selected.status) && (
              <section className="grid gap-3 rounded-xl border border-amber-800 bg-amber-950/20 p-4 sm:grid-cols-2">
                <h3 className="font-semibold text-white sm:col-span-2">Перенести замер</h3>
                <Field label="Новая дата и время"><input type="datetime-local" className={input} value={rescheduleDate} onChange={(event) => setRescheduleDate(event.target.value)} /></Field>
                {measurer ? <div className="text-sm text-slate-300">Замерщик<b className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">{selected.measurerUser?.name ?? "Текущий замерщик"}</b></div> : <Field label="Замерщик"><select className={input} value={rescheduleMeasurerId} onChange={(event) => setRescheduleMeasurerId(event.target.value)}><option value="">Выберите</option>{scheduleMeasurers.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></Field>}
                <div className="flex gap-2 sm:col-span-2">
                  <button type="button" onClick={() => setRescheduleOpen(false)} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-3">Отмена</button>
                  <button type="button" disabled={busy || !rescheduleDate || !rescheduleMeasurerId} onClick={() => void run({ action: "reschedule", visitDate: rescheduleDate, measurerUserId: Number(rescheduleMeasurerId), city: selected.city, address: selected.address, mapLink: selected.mapLink, comment: selected.managerComment }, "Замер перенесён").then(() => setRescheduleOpen(false))} className="min-h-11 flex-1 rounded-xl bg-amber-500 px-3 font-semibold text-slate-950 disabled:opacity-50">Сохранить</button>
                </div>
              </section>
            )}
            {canCloseOutcome && cancelOpen && ["ASSIGNED", "IN_PROGRESS"].includes(selected.status) && (
              <section className="space-y-3 rounded-xl border border-red-800 bg-red-950/20 p-4">
                <h3 className="font-semibold text-white">Отменить замер?</h3>
                <Field label="Причина"><input className={input} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Например: клиент перенёс решение" /></Field>
                <Field label="Комментарий"><textarea rows={2} className={input} value={cancelComment} onChange={(event) => setCancelComment(event.target.value)} /></Field>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setCancelOpen(false)} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-3">Не отменять</button>
                  <button type="button" disabled={busy || !cancelReason.trim()} onClick={() => void run({ action: "cancel", reason: cancelReason, comment: cancelComment }, "Замер отменён").then(() => setCancelOpen(false))} className="min-h-11 flex-1 rounded-xl bg-red-700 px-3 font-semibold disabled:opacity-50">Отменить замер</button>
                </div>
              </section>
            )}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              <a
                href={`tel:${selected.client.phone}`}
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-800 px-4"
              >
                <Phone size={18} />
                Позвонить
              </a>
              <a
                href={`https://wa.me/${(selected.client.whatsapp || selected.client.phone).replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-green-700 px-4"
              >
                <MessageCircle size={18} />
                WhatsApp
              </a>
              {(selected.mapLink || selected.address) && (
                <a
                  href={
                    selected.mapLink ||
                    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.city} ${selected.address}`)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                  className="col-span-2 flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-800 px-4"
                >
                  <MapPin size={18} />
                  Открыть карту
                </a>
              )}
            </div>
            <div className="rounded-xl bg-slate-900 p-4 text-sm text-slate-300">
              <b className="text-white">Ответственный менеджер:</b>{" "}
              {selected.client.managerUser?.name ?? "не указан"}
              {selected.managerComment && (
                <p className="mt-2">
                  <b className="text-white">Комментарий:</b>{" "}
                  {selected.managerComment}
                </p>
              )}
            </div>
            {measurer && selected.status === "ASSIGNED" && (
              <button
                disabled={busy}
                onClick={() => void run({ action: "start" }, "Замер начат")}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 font-semibold text-slate-950"
              >
                <Play size={18} />
                Начать замер
              </button>
            )}
            {measurer && selected.status === "IN_PROGRESS" && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Количество ступеней">
                    <input
                      type="number"
                      min="0"
                      inputMode="numeric"
                      className={input}
                      value={form.stepsCount}
                      onChange={(event) =>
                        patchForm("stepsCount", event.target.value)
                      }
                    />
                  </Field>
                  <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-700 px-3 text-sm text-slate-200">
                    <input
                      type="checkbox"
                      checked={form.sameSize}
                      onChange={(event) =>
                        patchForm("sameSize", event.target.checked)
                      }
                    />
                    Все ступени одного размера
                  </label>
                  {form.sameSize ? (
                    <>
                      <Field label="Длина, мм">
                        <input
                          type="number"
                          className={input}
                          value={form.stepLength}
                          onChange={(event) =>
                            patchForm("stepLength", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Ширина, мм">
                        <input
                          type="number"
                          className={input}
                          value={form.stepWidth}
                          onChange={(event) =>
                            patchForm("stepWidth", event.target.value)
                          }
                        />
                      </Field>
                      <Field label="Высота / толщина, мм">
                        <input
                          type="number"
                          className={input}
                          value={form.stepHeight}
                          onChange={(event) =>
                            patchForm("stepHeight", event.target.value)
                          }
                        />
                      </Field>
                    </>
                  ) : (
                    <DimensionRows
                      title="Размеры каждой ступени"
                      count={Number(form.stepsCount || 0)}
                      value={form.individualSteps}
                      withHeight
                      onChange={(value) => patchForm("individualSteps", value)}
                    />
                  )}
                  <Field label="Высота подступенка, мм">
                    <input
                      type="number"
                      className={input}
                      value={form.riserHeight}
                      onChange={(event) =>
                        patchForm("riserHeight", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Забежные ступени, шт">
                    <input
                      type="number"
                      min="0"
                      className={input}
                      value={form.winderCount}
                      onChange={(event) =>
                        patchForm("winderCount", event.target.value)
                      }
                    />
                  </Field>
                  <DimensionRows
                    title="Размеры забежных ступеней"
                    count={Number(form.winderCount || 0)}
                    value={form.winders}
                    withComment
                    onChange={(value) => patchForm("winders", value)}
                  />
                  <Field label="Площадки, шт">
                    <input
                      type="number"
                      min="0"
                      className={input}
                      value={form.platformsCount}
                      onChange={(event) =>
                        patchForm("platformsCount", event.target.value)
                      }
                    />
                  </Field>
                  <DimensionRows
                    title="Размеры площадок"
                    count={Number(form.platformsCount || 0)}
                    value={form.platforms}
                    onChange={(value) => patchForm("platforms", value)}
                  />
                  <Field label="Длина ограждения, м">
                    <input
                      type="number"
                      step="0.1"
                      className={input}
                      value={form.railingLength}
                      onChange={(event) =>
                        patchForm("railingLength", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Комментарий к ограждению">
                    <input
                      className={input}
                      value={form.railingComment}
                      onChange={(event) =>
                        patchForm("railingComment", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Особенности объекта">
                    <textarea
                      rows={3}
                      className={input}
                      value={form.objectNotes}
                      onChange={(event) =>
                        patchForm("objectNotes", event.target.value)
                      }
                    />
                  </Field>
                  <Field label="Комментарий замерщика">
                    <textarea
                      rows={3}
                      className={input}
                      value={form.comment}
                      onChange={(event) =>
                        patchForm("comment", event.target.value)
                      }
                    />
                  </Field>
                </div>
                <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                  <h3 className="font-semibold text-white">Фотографии</h3>
                  <p className="mt-1 text-sm text-slate-400">
                    Фото листа замера обязательно для завершения. На телефоне
                    можно сразу открыть камеру.
                  </p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-3">
                    <button
                      disabled={busy}
                      onClick={() => choosePhoto("SHEET")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm"
                    >
                      <Upload size={17} />
                      Фото замерного листа
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => choosePhoto("OBJECT")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm"
                    >
                      <Upload size={17} />
                      Фото объекта
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => choosePhoto("EXTRA")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-700 px-3 text-sm"
                    >
                      <Upload size={17} />
                      Дополнительное фото
                    </button>
                  </div>
                  <input
                    ref={photoRef}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    onChange={(event) => void upload(event.target.files?.[0])}
                  />
                  <PhotoList photos={selected.attachments} />
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(payload("save-draft"), "Черновик сохранён")
                    }
                    className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-slate-700 font-semibold"
                  >
                    <Save size={18} />
                    Сохранить черновик
                  </button>
                </div>
                <section className="space-y-4 rounded-xl border border-emerald-800/60 bg-emerald-950/10 p-4">
                  <div>
                    <h3 className="font-semibold text-white">Результат общения с клиентом</h3>
                    <p className="mt-1 text-sm text-slate-400">Что сказал клиент после замера? Выбор обязателен для завершения.</p>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {([
                      ["READY_TO_CONTINUE", "Готов продолжить"],
                      ["RETURN_TO_MANAGER", "Вернуть менеджеру"],
                      ["REFUSED", "Отказался"],
                    ] as const).map(([value, label]) => (
                      <label key={value} className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm ${clientOutcome === value ? "border-emerald-500 bg-emerald-950/50 text-white" : "border-slate-700 bg-slate-950 text-slate-300"}`}>
                        <input type="radio" name="client-outcome" value={value} checked={clientOutcome === value} onChange={() => { setClientOutcome(value); if (value !== "REFUSED") setRefusalReason(""); }} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {clientOutcome === "REFUSED" && (
                    <Field label="Причина отказа"><select className={input} value={refusalReason} onChange={(event) => setRefusalReason(event.target.value)}><option value="">Выберите причину</option>{refusalReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
                  )}
                  {(clientOutcome === "RETURN_TO_MANAGER" || clientOutcome === "REFUSED") && (
                    <Field label={clientOutcome === "RETURN_TO_MANAGER" ? "Комментарий менеджеру" : "Комментарий к результату"}><textarea rows={3} className={input} value={outcomeComment} onChange={(event) => setOutcomeComment(event.target.value)} placeholder={clientOutcome === "RETURN_TO_MANAGER" ? "Что должен сделать менеджер" : "Дополнительные детали"} /></Field>
                  )}
                  <button
                    disabled={busy || !clientOutcome || (clientOutcome === "RETURN_TO_MANAGER" && !outcomeComment.trim()) || (clientOutcome === "REFUSED" && (!refusalReason || (refusalReason === "OTHER" && !outcomeComment.trim())))}
                    onClick={() => void complete()}
                    className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold disabled:opacity-50"
                  >
                    <CheckCircle2 size={18} />
                    Завершить замер
                  </button>
                </section>
              </>
            )}
            {["COMPLETED", "HANDED_TO_MANAGER"].includes(selected.status) && (
              <MeasurementResult row={selected} />
            )}
            {measurer && selected.status === "COMPLETED" && !selected.clientOutcome && (
              <button
                disabled={busy}
                onClick={() =>
                  void run({ action: "handoff" }, "Замер передан менеджеру")
                }
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 font-semibold"
              >
                <ClipboardCheck size={18} />
                Передать менеджеру
              </button>
            )}
            {selected.status === "CANCELLED" && (
              <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-sm text-slate-300">
                <h3 className="font-semibold text-white">Замер отменён</h3>
                {(() => {
                  const event = selected.auditEvents.find((item) => item.action === "MEASUREMENT_CANCELLED" || item.action === "CANCELLED");
                  return event ? <div className="mt-2 space-y-1"><p>{event.comment || "Причина не указана"}</p><p className="text-slate-500">{when(event.createdAt)} · {event.actor?.name ?? "Система"}</p></div> : <p className="mt-2 text-slate-500">История отмены сохранена.</p>;
                })()}
              </section>
            )}
            {measurer && selected.status === "HANDED_TO_MANAGER" && (
              <section className="space-y-3 rounded-xl border border-violet-900 bg-violet-950/20 p-4">
                <h3 className="font-semibold text-white">
                  Продолжение с менеджером
                </h3>
                <button
                  disabled={busy || Boolean(selected.readyForContractAt)}
                  onClick={() =>
                    void run(
                      { action: "ready-contract" },
                      "Менеджеру создана приоритетная задача",
                    )
                  }
                  className="min-h-12 w-full rounded-xl bg-emerald-700 px-4 font-semibold disabled:opacity-50"
                >
                  {selected.readyForContractAt
                    ? "Готовность к договору передана"
                    : "Клиент готов к договору"}
                </button>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Дата и время встречи">
                    <input
                      type="datetime-local"
                      className={input}
                      value={inviteAt}
                      onChange={(event) => setInviteAt(event.target.value)}
                    />
                  </Field>
                  <Field label="Комментарий">
                    <input
                      className={input}
                      value={inviteComment}
                      onChange={(event) => setInviteComment(event.target.value)}
                    />
                  </Field>
                </div>
                <button
                  disabled={busy || !inviteAt}
                  onClick={() =>
                    void run(
                      {
                        action: "invite-office",
                        dueAt: inviteAt,
                        comment: inviteComment,
                      },
                      "Встреча в офисе создана в календаре менеджера",
                    )
                  }
                  className="min-h-12 w-full rounded-xl bg-blue-700 px-4 font-semibold disabled:opacity-50"
                >
                  Пригласить клиента в офис
                </button>
              </section>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Kpi({
  title,
  value,
  alert = false,
}: {
  title: string;
  value: string | number;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${alert && Number(value) > 0 ? "border-red-800 bg-red-950/30" : "border-slate-800 bg-[#101827]"}`}
    >
      <p className="text-xs text-slate-400 sm:text-sm">{title}</p>
      <b className="mt-2 block text-xl text-white sm:text-2xl">{value}</b>
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
      <span className="mb-1 block">{label}</span>
      {children}
    </label>
  );
}

function DimensionRows({
  title,
  count,
  value,
  withHeight = false,
  withComment = false,
  onChange,
}: {
  title: string;
  count: number;
  value: string;
  withHeight?: boolean;
  withComment?: boolean;
  onChange: (value: string) => void;
}) {
  const current = value.split("\n");
  const rows = Array.from(
    { length: Math.max(0, Math.min(count, 100)) },
    (_, index) => {
      const [size = "", comment = ""] = (current[index] ?? "").split(
        /\s+[—-]\s+/,
        2,
      );
      const [length = "", width = "", height = ""] = size.split(/\s*[x×х]\s*/i);
      return { length, width, height, comment };
    },
  );
  const change = (
    index: number,
    key: "length" | "width" | "height" | "comment",
    next: string,
  ) => {
    const updated = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, [key]: next } : row,
    );
    onChange(
      updated
        .map((row) =>
          `${row.length} x ${row.width}${withHeight ? ` x ${row.height}` : ""}${withComment && row.comment ? ` — ${row.comment}` : ""}`.trim(),
        )
        .join("\n"),
    );
  };
  return (
    <fieldset className="space-y-2 rounded-xl border border-slate-700 p-3 sm:col-span-2">
      <legend className="px-1 text-sm text-slate-300">{title}</legend>
      {rows.length ? (
        rows.map((row, index) => (
          <div
            key={index}
            className={`grid gap-2 ${withHeight || withComment ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2"}`}
          >
            <label className="text-xs text-slate-400">
              Длина, мм
              <input
                type="number"
                inputMode="decimal"
                className={input}
                value={row.length}
                onChange={(event) =>
                  change(index, "length", event.target.value)
                }
              />
            </label>
            <label className="text-xs text-slate-400">
              Ширина, мм
              <input
                type="number"
                inputMode="decimal"
                className={input}
                value={row.width}
                onChange={(event) => change(index, "width", event.target.value)}
              />
            </label>
            {withHeight && (
              <label className="text-xs text-slate-400">
                Высота, мм
                <input
                  type="number"
                  inputMode="decimal"
                  className={input}
                  value={row.height}
                  onChange={(event) =>
                    change(index, "height", event.target.value)
                  }
                />
              </label>
            )}
            {withComment && (
              <label className="text-xs text-slate-400">
                Комментарий
                <input
                  className={input}
                  value={row.comment}
                  onChange={(event) =>
                    change(index, "comment", event.target.value)
                  }
                />
              </label>
            )}
            <span className="self-center text-xs text-slate-500">
              № {index + 1}
            </span>
          </div>
        ))
      ) : (
        <p className="text-sm text-slate-500">
          Укажите количество — строки появятся автоматически.
        </p>
      )}
    </fieldset>
  );
}
function PhotoList({ photos }: { photos: Photo[] }) {
  return photos.length ? (
    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo) => (
        <a
          key={photo.id}
          href={`/api/measurement-attachments/${photo.id}`}
          target="_blank"
          rel="noreferrer"
          className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 text-sm text-blue-200"
        >
          <Image
            src={`/api/measurement-attachments/${photo.id}`}
            alt={photo.fileName}
            width={320}
            height={112}
            unoptimized
            className="h-28 w-full bg-slate-950 object-cover"
          />
          <span className="block p-2">
            <span className="block truncate font-medium">
              {photo.type === "SHEET"
                ? "Лист замера"
                : photo.type === "OBJECT"
                  ? "Фото объекта"
                  : photo.fileName}
            </span>
            <span className="mt-1 block text-xs text-slate-500">
              {photo.createdAt
                ? new Date(photo.createdAt).toLocaleDateString("ru-RU")
                : "Сохранено"}
            </span>
          </span>
        </a>
      ))}
    </div>
  ) : (
    <p className="mt-3 rounded-lg border border-dashed border-slate-700 p-3 text-center text-sm text-slate-500">
      Фотографии ещё не добавлены.
    </p>
  );
}
function MeasurementResult({ row }: { row: Measurement }) {
  return (
    <section className="rounded-xl border border-emerald-800/50 bg-emerald-950/10 p-4">
      <h3 className="font-semibold text-white">Зафиксированный результат</h3>
      <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-slate-300 sm:grid-cols-3">
        <span>
          Ступени
          <br />
          <b className="text-white">{row.stepsCount ?? 0}</b>
        </span>
        <span>
          Размер
          <br />
          <b className="text-white">
            {row.sameSize
              ? `${row.stepLength} × ${row.stepWidth} мм`
              : "индивидуальный"}
          </b>
        </span>
        <span>
          Подступенок
          <br />
          <b className="text-white">{row.riserHeight ?? "—"} мм</b>
        </span>
        <span>
          Забежные
          <br />
          <b className="text-white">{row.winderCount}</b>
        </span>
        <span>
          Площадки
          <br />
          <b className="text-white">{row.platformsCount}</b>
        </span>
        <span>
          Ограждение
          <br />
          <b className="text-white">{row.railingLength ?? 0} м</b>
        </span>
      </div>
      {row.objectNotes && (
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-300">
          {row.objectNotes}
        </p>
      )}
      {row.clientOutcome && (
        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
          <b className="text-white">Результат клиента: {outcomeNames[row.clientOutcome] ?? row.clientOutcome}</b>
          {row.refusalReason && <p className="mt-1">Причина: {refusalReasons.find(([value]) => value === row.refusalReason)?.[1] ?? row.refusalReason}</p>}
          {row.outcomeComment && <p className="mt-1 whitespace-pre-wrap">{row.outcomeComment}</p>}
          {row.outcomeAt && <p className="mt-1 text-xs text-slate-500">Зафиксировано {when(row.outcomeAt)}</p>}
        </div>
      )}
      <PhotoList photos={row.attachments} />
    </section>
  );
}
