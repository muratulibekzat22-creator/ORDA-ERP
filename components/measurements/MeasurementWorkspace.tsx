"use client";

import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useRef, useState } from "react";
import DirectorMeasurementControl from "@/components/measurements/DirectorMeasurementControl";
import MeasurementDesignWorkflow from "@/components/measurements/MeasurementDesignWorkflow";
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
import { measurerTerritoryMatch, travelTimeLabel, type MeasurerServiceArea } from "@/lib/measurements/measurer-territory";

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
  designStyle: string;
  designNotes: string;
  designPromptCopiedAt?: string | null;
  designShownAt?: string | null;
  comment?: string | null;
  client: {
    id: number;
    name: string;
    phone: string;
    whatsapp: string;
    city: string;
    address: string;
    managerUser?: { id: number; name: string; phone?: string | null } | null;
    commercialProposals: Array<{ id: number; number: string; status: string; total?: string | number | null; snapshot: unknown; createdAt: string }>;
    orders: Array<{ id: number; number: string; status: string; lifecycle: string }>;
  };
  measurerUser?: { id: number; name: string; role?: string } | null;
  attachments: Photo[];
  order?: { id: number; number: string } | null;
  readyForContractAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
  clientOutcome?: "READY_TO_CONTINUE" | "RETURN_TO_MANAGER" | "REFUSED" | null;
  outcomeComment?: string | null;
  refusalReason?: string | null;
  outcomeAt?: string | null;
  sourceProposalId?: number | null;
  finalProposalId?: number | null;
  quoteMaterial?: string;
  quoteBasePrice?: string | number | null;
  quoteDiscount?: string | number;
  quoteFinalPrice?: string | number | null;
  quoteComment?: string | null;
  quoteConfirmedAt?: string | null;
  finalProposal?: { id: number; number: string; status: string; total?: string | number | null } | null;
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
type ScheduleOrder = { id: number; number: string; client: { id: number; name: string; phone: string } };
type ActiveMeasurer = { id: number; name: string; phone?: string | null; role: string; homeCity: string; maxTravelMinutes: number; serviceAreas: MeasurerServiceArea[] };
type QuoteForm = { sourceProposalId: string; material: string; discount: string; comment: string; confirmedWithClient: boolean };
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
const territoryRank = { AVAILABLE: 0, UNCONFIGURED: 1, APPROVAL_REQUIRED: 2, OUTSIDE_AREA: 3 } as const;
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

function safeProposalVariants(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return [];
  const variants = (snapshot as Record<string, unknown>).variants;
  if (!Array.isArray(variants)) return [];
  return variants.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>, total = Number(row.total ?? 0), material = String(row.material ?? "").trim();
    return material && Number.isFinite(total) && total > 0 ? [{ material, total }] : [];
  });
}

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
  if (session?.user.role === "DIRECTOR" || session?.user.role === "OPERATIONS_DIRECTOR")
    return <LeadershipMeasurementWorkspace />;
  return <OperationalMeasurementWorkspace />;
}

function LeadershipMeasurementWorkspace() {
  const [mode, setMode] = useState<"control" | "field">("control");
  return <>
    <div className="mx-4 mt-4 grid gap-2 rounded-2xl border border-slate-800 bg-[#101827] p-2 md:mx-8 md:grid-cols-2">
      <button type="button" onClick={() => setMode("control")} className={`min-h-20 rounded-xl px-4 py-3 text-left ${mode === "control" ? "bg-amber-300 text-slate-950" : "bg-slate-900 text-slate-300"}`}><b className="block text-sm">Контроль всех замеров</b><span className={`mt-1 block text-xs leading-5 ${mode === "control" ? "text-slate-800" : "text-slate-500"}`}>Проверить расписание, ответственных, просрочки и результаты всей команды.</span></button>
      <button type="button" onClick={() => setMode("field")} className={`min-h-20 rounded-xl px-4 py-3 text-left ${mode === "field" ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}><b className="block text-sm">Провести назначенный замер</b><span className={`mt-1 block text-xs leading-5 ${mode === "field" ? "text-blue-100" : "text-slate-500"}`}>Открыть существующий замер и заполнить размеры, фотографии и результат.</span></button>
    </div>
    {mode === "control" ? <DirectorMeasurementControl /> : <OperationalMeasurementWorkspace />}
  </>;
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
  const [quote, setQuote] = useState<QuoteForm>({ sourceProposalId: "", material: "", discount: "0", comment: "", confirmedWithClient: false });
  const [linkOrderId, setLinkOrderId] = useState("");
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
    [rescheduleMeasurerId, setRescheduleMeasurerId] = useState(""),
    [rescheduleTravelApproved, setRescheduleTravelApproved] = useState(false);
  const [creating, setCreating] = useState(false), [createOpen, setCreateOpen] = useState(false),
    [createForm, setCreateForm] = useState({ clientName: "", phone: "", city: "", visitDate: "", address: "", mapLink: "", comment: "" });
  const [scheduleOpen, setScheduleOpen] = useState(false),
    [scheduleClients, setScheduleClients] = useState<ScheduleClient[]>([]),
    [scheduleOrders, setScheduleOrders] = useState<ScheduleOrder[]>([]),
    [scheduleOrdersLoading, setScheduleOrdersLoading] = useState(false),
    [scheduleMeasurers, setScheduleMeasurers] = useState<ActiveMeasurer[]>([]),
    [scheduleClientSearch, setScheduleClientSearch] = useState(""),
    [scheduleClientSearching, setScheduleClientSearching] = useState(false),
    [scheduleSelectedClient, setScheduleSelectedClient] = useState<ScheduleClient | null>(null),
    [whatsappText, setWhatsappText] = useState(""),
    [whatsappMeasurerText, setWhatsappMeasurerText] = useState(""),
    [whatsappMeasurerPhone, setWhatsappMeasurerPhone] = useState(""),
    [scheduleForm, setScheduleForm] = useState({ clientId: "", orderId: "", measurerUserId: "", visitDate: "", city: "", address: "", mapLink: "", comment: "", travelApproved: false });
  const photoRef = useRef<HTMLInputElement>(null),
    [photoType, setPhotoType] = useState("SHEET");
  const role = session?.user.role;
  const leadership = role === "DIRECTOR" || role === "OPERATIONS_DIRECTOR";
  const measurer = role === "MEASURER";
  const measurementPerformer = measurer || leadership;
  const canSchedule = role === "MANAGER" || leadership;
  const selectMeasurement = (row: Measurement) => {
    setSelectedId(row.id);
    setForm(formOf(row));
    setClientOutcome(row.clientOutcome ?? "");
    setOutcomeComment(row.outcomeComment ?? "");
    setRefusalReason(row.refusalReason ?? "");
    setQuote({ sourceProposalId: row.sourceProposalId ? String(row.sourceProposalId) : "", material: row.quoteMaterial ?? "", discount: String(row.quoteDiscount ?? 0), comment: row.quoteComment ?? "", confirmedWithClient: Boolean(row.quoteConfirmedAt) });
    setLinkOrderId(row.order?.id ? String(row.order.id) : "");
    setCancelOpen(false);
    setRescheduleOpen(false);
    setRescheduleDate(new Date(row.visitDate).toISOString().slice(0, 16));
    setRescheduleMeasurerId(row.measurerUser ? String(row.measurerUser.id) : "");
  };
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!scheduleOpen || scheduleSelectedClient) return;
    const query = scheduleClientSearch.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setScheduleClientSearching(true);
      try {
        const params = new URLSearchParams({ active: "true", limit: "20", search: query });
        const response = await fetch(`/api/clients?${params}`, { cache: "no-store", signal: controller.signal });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) setError(body.error ?? "Не удалось найти заявку");
        else setScheduleClients((body.data ?? []) as ScheduleClient[]);
      } catch (reason) {
        if (!(reason instanceof DOMException && reason.name === "AbortError")) setError("Не удалось найти заявку");
      } finally {
        if (!controller.signal.aborted) setScheduleClientSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [scheduleClientSearch, scheduleOpen, scheduleSelectedClient]);
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
        setQuote({ sourceProposalId: requestedMeasurement.sourceProposalId ? String(requestedMeasurement.sourceProposalId) : "", material: requestedMeasurement.quoteMaterial ?? "", discount: String(requestedMeasurement.quoteDiscount ?? 0), comment: requestedMeasurement.quoteComment ?? "", confirmedWithClient: Boolean(requestedMeasurement.quoteConfirmedAt) });
        setLinkOrderId(requestedMeasurement.order?.id ? String(requestedMeasurement.order.id) : "");
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
          setQuote({ sourceProposalId: detail.sourceProposalId ? String(detail.sourceProposalId) : "", material: detail.quoteMaterial ?? "", discount: String(detail.quoteDiscount ?? 0), comment: detail.quoteComment ?? "", confirmedWithClient: Boolean(detail.quoteConfirmedAt) });
          setLinkOrderId(detail.order?.id ? String(detail.order.id) : "");
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
  const selectedProposal = selected?.client.commercialProposals.find((item) => item.id === Number(quote.sourceProposalId));
  const quoteVariants = selectedProposal ? safeProposalVariants(selectedProposal.snapshot) : [];
  const quoteVariant = quoteVariants.find((item) => item.material === quote.material);
  const quoteFinalPrice = Math.max(0, (quoteVariant?.total ?? 0) - Number(quote.discount || 0));
  const rows = data.measurements;
  const currentUserId = Number(session?.user.id);
  const selectedLeader = selected?.measurerUser?.role === "DIRECTOR" || selected?.measurerUser?.role === "OPERATIONS_DIRECTOR";
  const canPerformSelected = Boolean(
    selected?.measurerUser &&
      (selected.measurerUser.id === currentUserId || (leadership && selectedLeader)),
  );
  const canClaimSelected = Boolean(
    measurementPerformer &&
      selected &&
      !selected.measurerUser &&
      ["ASSIGNED", "IN_PROGRESS"].includes(selected.status),
  );
  const canCloseOutcome = canSchedule || canPerformSelected;
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
  const quotePayload = () => ({
    sourceProposalId: Number(quote.sourceProposalId), quoteMaterial: quote.material,
    quoteDiscount: Number(quote.discount || 0), quoteComment: quote.comment,
    quoteConfirmedWithClient: quote.confirmedWithClient,
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
    if (clientOutcome === "READY_TO_CONTINUE" && (!quote.sourceProposalId || !quote.material || !quote.confirmedWithClient || quoteFinalPrice <= 0)) {
      setError("Для готового клиента выберите КП, материал, окончательную цену и подтвердите согласование");
      return;
    }
    await run(
      { ...payload("complete"), ...(quote.sourceProposalId ? quotePayload() : {}), clientOutcome, refusalReason: clientOutcome === "REFUSED" ? refusalReason : undefined, outcomeComment },
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
  function choosePhoto(type: "SHEET" | "OPENING" | "EXTRA") {
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
    setError("");
    const metaResponse = await fetch("/api/measurements?meta=1", { cache: "no-store" });
    const metaBody = await metaResponse.json().catch(() => ({}));
    if (!metaResponse.ok) return setError(metaBody.error ?? "Не удалось загрузить форму назначения");
    setScheduleMeasurers((metaBody.measurers ?? []) as ActiveMeasurer[]);
    setScheduleForm((current) => ({ ...current, measurerUserId: "" }));
    setScheduleOpen(true);
  }
  async function openReschedule() {
    setCancelOpen(false);
    setRescheduleOpen(true);
    setRescheduleTravelApproved(false);
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
  async function chooseScheduleClient(clientId: string) {
    const client = scheduleClients.find((row) => String(row.id) === clientId);
    setScheduleSelectedClient(client ?? null);
    if (client) setScheduleClientSearch(client.phone);
    setScheduleOrders([]);
    setScheduleForm((current) => ({ ...current, clientId, orderId: "", city: client?.city ?? "", address: client?.address ?? "" }));
    if (!client) return;
    setScheduleOrdersLoading(true);
    try {
      const params = new URLSearchParams({ q: client.phone || client.name, limit: "20" });
      const response = await fetch(`/api/orders/search?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error ?? "Не удалось загрузить заказы клиента");
      else setScheduleOrders(((body.items ?? []) as ScheduleOrder[]).filter((order) => order.client.id === client.id));
    } catch {
      setError("Не удалось загрузить заказы клиента");
    } finally {
      setScheduleOrdersLoading(false);
    }
  }
  async function scheduleMeasurement(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setWhatsappText(""); setWhatsappMeasurerText(""); setWhatsappMeasurerPhone("");
    const response = await fetch("/api/measurements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...scheduleForm, clientId: Number(scheduleForm.clientId), orderId: scheduleForm.orderId ? Number(scheduleForm.orderId) : undefined, measurerUserId: scheduleForm.measurerUserId ? Number(scheduleForm.measurerUserId) : undefined }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось назначить замер");
    else {
      setNotice(body.measurement?.measurerUserId ? "Замер назначен и появился в календаре ответственного" : "Замер сохранён. Ответственного можно назначить позже");
      setWhatsappText(body.whatsappGroupText ?? body.whatsappText ?? "");
      setWhatsappMeasurerText(body.whatsappMeasurerText ?? "");
      setWhatsappMeasurerPhone(body.measurerPhone ?? "");
      setScheduleOpen(false);
      setScheduleClients([]);
      setScheduleOrders([]);
      setScheduleClientSearch("");
      setScheduleSelectedClient(null);
      setScheduleForm({ clientId: "", orderId: "", measurerUserId: "", visitDate: "", city: "", address: "", mapLink: "", comment: "", travelApproved: false });
      await load();
    }
    setBusy(false);
  }
  const availableScheduleMeasurers = scheduleMeasurers
    .map((row) => ({ row, match: row.role === "MEASURER" ? measurerTerritoryMatch(row, scheduleForm.city) : { status: "UNCONFIGURED" as const, area: null } }))
    .filter(({ match }) => match.status !== "OUTSIDE_AREA")
    .sort((a, b) => territoryRank[a.match.status] - territoryRank[b.match.status]);
  const selectedScheduleMeasurer = scheduleMeasurers.find((row) => String(row.id) === scheduleForm.measurerUserId);
  const selectedScheduleTerritory = selectedScheduleMeasurer?.role === "MEASURER" ? measurerTerritoryMatch(selectedScheduleMeasurer, scheduleForm.city) : null;
  const selectedRescheduleMeasurer = scheduleMeasurers.find((row) => String(row.id) === rescheduleMeasurerId);
  const selectedRescheduleTerritory = selected && selectedRescheduleMeasurer?.role === "MEASURER" ? measurerTerritoryMatch(selectedRescheduleMeasurer, selected.city) : null;
  return (
    <main className="space-y-5 p-4 pb-24 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white md:text-3xl">
            {measurer ? "Кабинет замерщика" : leadership ? "Провести назначенный замер" : "Замеры клиентов"}
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            {leadership ? "Выберите существующий замер из списка или назначьте новый по заявке либо заказу." : "Расписание, фактические размеры и передача результата менеджеру"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {measurer && <button type="button" onClick={() => setCreateOpen((value) => !value)} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-semibold"><Plus size={17}/>Новый замер без заявки</button>}
          {measurer && <Link
            href="/payroll"
            className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-800 px-4 text-sm text-white"
          >
            <Banknote size={17} />
            Моя зарплата
          </Link>}
          {canSchedule && <button type="button" onClick={() => void openSchedule()} className="flex min-h-11 items-center gap-2 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-slate-950"><Plus size={17}/>Назначить замер</button>}
        </div>
      </header>
      {canSchedule && scheduleOpen && <form onSubmit={scheduleMeasurement} className="grid gap-3 rounded-2xl border border-amber-800 bg-[#101827] p-4 sm:grid-cols-2 lg:grid-cols-3">
        <h2 className="text-lg font-semibold text-white sm:col-span-2 lg:col-span-3">Назначить замер по заявке или заказу</h2>
        <p className="rounded-xl border border-amber-900/70 bg-amber-950/20 px-3 py-2 text-sm leading-6 text-amber-100 sm:col-span-2 lg:col-span-3">Здесь выбирается существующий клиент из CRM. Если клиента ещё нет, сначала создайте его в разделе <Link href="/clients" className="font-semibold underline underline-offset-2">«Заявки»</Link>, затем вернитесь и назначьте замер.</p>
        <div className="relative sm:col-span-2 lg:col-span-3">
          <label htmlFor="measurement-client-search" className="mb-1 block text-sm text-slate-300">Телефон или имя клиента</label>
          <input
            id="measurement-client-search"
            type="search"
            autoComplete="tel"
            className={input}
            value={scheduleClientSearch}
            onChange={(event) => {
              const value = event.target.value;
              setScheduleClientSearch(value);
              setScheduleClients([]);
              setScheduleClientSearching(value.trim().length >= 2);
              if (scheduleSelectedClient) {
                setScheduleSelectedClient(null);
                setScheduleOrders([]);
                setScheduleForm((current) => ({ ...current, clientId: "", orderId: "", city: "", address: "" }));
              }
            }}
            placeholder="Например: 8 707 123 45 67 или имя"
          />
          {!scheduleSelectedClient && scheduleClientSearch.trim().length < 2 && <p className="mt-1 text-xs text-slate-500">Введите номер вручную — система найдёт заявку по телефону.</p>}
          {!scheduleSelectedClient && scheduleClientSearching && <p className="mt-2 text-sm text-slate-400">Поиск заявки…</p>}
          {!scheduleSelectedClient && !scheduleClientSearching && scheduleClientSearch.trim().length >= 2 && scheduleClients.length === 0 && <p className="mt-2 rounded-xl border border-dashed border-slate-700 p-3 text-sm text-slate-400">Заявка не найдена. Проверьте номер или имя клиента.</p>}
          {!scheduleSelectedClient && scheduleClients.length > 0 && <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 p-2">
            {scheduleClients.map((client) => <button key={client.id} type="button" onClick={() => chooseScheduleClient(String(client.id))} className="block min-h-12 w-full rounded-lg px-3 py-2 text-left hover:bg-slate-800">
              <b className="block text-sm text-white">{client.name || "Без имени"}</b>
              <span className="block text-sm text-blue-200">{client.phone}</span>
              {(client.city || client.address) && <span className="block truncate text-xs text-slate-500">{[client.city, client.address].filter(Boolean).join(" · ")}</span>}
            </button>)}
          </div>}
          {scheduleSelectedClient && <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-800 bg-emerald-950/20 p-3">
            <span><b className="block text-emerald-100">{scheduleSelectedClient.name || "Без имени"}</b><span className="text-sm text-emerald-200">{scheduleSelectedClient.phone}</span></span>
            <button type="button" onClick={() => { setScheduleSelectedClient(null); setScheduleClients([]); setScheduleOrders([]); setScheduleClientSearching(scheduleClientSearch.trim().length >= 2); setScheduleForm((current) => ({ ...current, clientId: "", orderId: "", city: "", address: "" })); }} className="min-h-10 rounded-lg bg-slate-800 px-3 text-sm text-white">Изменить</button>
          </div>}
        </div>
        <Field label="Основание замера">
          <select disabled={!scheduleSelectedClient || scheduleOrdersLoading} className={input} value={scheduleForm.orderId} onChange={(event) => setScheduleForm({ ...scheduleForm, orderId: event.target.value })}>
            <option value="">Заявка клиента (без заказа)</option>
            {scheduleOrders.map((order) => <option key={order.id} value={order.id}>Заказ {order.number}</option>)}
          </select>
          <span className="mt-1 block text-xs text-slate-500">{scheduleOrdersLoading ? "Загружаем действующие заказы…" : scheduleOrders.length ? "Можно оставить заявку без заказа или сразу выбрать заказ." : "Если действующего заказа нет, замер сохранится в заявке клиента."}</span>
        </Field>
        <Field label="Ответственный за замер (необязательно)"><select className={input} value={scheduleForm.measurerUserId} onChange={(event) => setScheduleForm({...scheduleForm, measurerUserId:event.target.value, travelApproved: false})}><option value="">Ответственный не выбран</option>{availableScheduleMeasurers.map(({ row, match }) => <option key={row.id} value={row.id}>{row.name}{row.role === "DIRECTOR" ? " · основатель" : row.role === "OPERATIONS_DIRECTOR" ? " · директор" : match.area ? ` · ${match.area.city}, ${travelTimeLabel(match.area.estimatedMinutes)}` : " · зона не настроена"}{match.status === "APPROVAL_REQUIRED" ? " · по согласованию" : ""}</option>)}</select><span className="mt-1 block text-xs text-slate-500">{selectedScheduleMeasurer ? `${selectedScheduleMeasurer.role === "MEASURER" ? selectedScheduleMeasurer.homeCity ? `База: ${selectedScheduleMeasurer.homeCity}` : "База не настроена" : "Руководитель компании"}${selectedScheduleMeasurer.phone ? ` · ${selectedScheduleMeasurer.phone}` : " · телефон не указан"}` : scheduleForm.city && !availableScheduleMeasurers.length ? "Для города нет доступного сотрудника" : "Можно оставить свободным и назначить позже."}</span></Field>
        {selectedScheduleTerritory?.status === "APPROVAL_REQUIRED" && <Field label="Дальний маршрут"><label className="flex min-h-11 items-center gap-3 rounded-xl border border-amber-700 bg-amber-950/20 px-3 text-sm text-amber-100"><input type="checkbox" checked={scheduleForm.travelApproved} onChange={(event) => setScheduleForm({ ...scheduleForm, travelApproved: event.target.checked })}/>Выезд согласован с замерщиком</label></Field>}
        <Field label="Дата замера"><input required type="date" className={input} value={scheduleForm.visitDate.split("T")[0] ?? ""} onChange={(event) => setScheduleForm({...scheduleForm,visitDate:event.target.value ? `${event.target.value}T${scheduleForm.visitDate.split("T")[1] || "09:00"}` : ""})}/></Field>
        <Field label="Время"><input required type="time" className={input} value={scheduleForm.visitDate.split("T")[1] ?? ""} onChange={(event) => setScheduleForm({...scheduleForm,visitDate:scheduleForm.visitDate.split("T")[0] ? `${scheduleForm.visitDate.split("T")[0]}T${event.target.value}` : ""})}/></Field>
        <Field label="Город"><input className={input} value={scheduleForm.city} onChange={(event) => setScheduleForm({...scheduleForm,city:event.target.value, measurerUserId:"", travelApproved:false})}/></Field>
        <Field label="Адрес"><input className={input} value={scheduleForm.address} onChange={(event) => setScheduleForm({...scheduleForm,address:event.target.value})}/></Field>
        <Field label="Ссылка на карту"><input type="url" className={input} value={scheduleForm.mapLink} onChange={(event) => setScheduleForm({...scheduleForm,mapLink:event.target.value})}/></Field>
        <Field label="Комментарий менеджера"><input className={input} value={scheduleForm.comment} onChange={(event) => setScheduleForm({...scheduleForm,comment:event.target.value})}/></Field>
        <button disabled={busy || !scheduleForm.clientId || !scheduleForm.visitDate || (!scheduleForm.address.trim() && !scheduleForm.mapLink.trim()) || (selectedScheduleTerritory?.status === "APPROVAL_REQUIRED" && !scheduleForm.travelApproved)} className="min-h-12 rounded-xl bg-amber-500 px-4 font-semibold text-slate-950 disabled:opacity-50 sm:col-span-2 lg:col-span-3">Сохранить замер</button>
      </form>}
      {whatsappText && <section className="rounded-2xl border border-green-900 bg-green-950/20 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><b className="text-green-200">Сообщение в общую WhatsApp-группу</b><button type="button" onClick={() => void navigator.clipboard.writeText(whatsappText).then(() => setNotice("Текст для группы скопирован"))} className="min-h-11 rounded-xl bg-green-700 px-4 text-sm font-semibold">Копировать в группу</button></div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-slate-200">{whatsappText}</pre>{whatsappMeasurerText && <div className="mt-4 border-t border-green-900 pt-4"><div className="flex flex-wrap items-center justify-between gap-3"><b className="text-green-200">Личное сообщение замерщику</b><div className="flex flex-wrap gap-2">{whatsappMeasurerPhone && <a href={`https://wa.me/${whatsappMeasurerPhone.replace(/\D/g, "")}?text=${encodeURIComponent(whatsappMeasurerText)}`} target="_blank" rel="noreferrer" className="min-h-11 rounded-xl bg-green-700 px-4 py-3 text-sm font-semibold">Открыть WhatsApp</a>}<button type="button" onClick={() => void navigator.clipboard.writeText(whatsappMeasurerText).then(() => setNotice("Сообщение замерщику скопировано"))} className="min-h-11 rounded-xl bg-slate-700 px-4 text-sm font-semibold">Копировать замерщику</button></div></div><pre className="mt-3 whitespace-pre-wrap font-sans text-sm text-slate-200">{whatsappMeasurerText}</pre></div>}</section>}
      {measurer && createOpen && <form onSubmit={createOwnMeasurement} className="grid gap-3 rounded-2xl border border-blue-900 bg-[#101827] p-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><h2 className="text-lg font-semibold text-white">Новый замер без заявки</h2><p className="mt-1 text-sm leading-6 text-slate-400">Используйте только при выезде к клиенту, которого ещё нет в CRM. Система проверит телефон, создаст клиента при необходимости и назначит замер вам.</p></div>
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
                    <span className={`mt-1 block text-xs ${row.measurerUser ? "text-slate-500" : "font-semibold text-amber-300"}`}>Ответственный за замер: {row.measurerUser?.name ?? "не выбран — можно взять себе"}</span>
                    {row.measurerUser?.role === "PARTNER" && <span className="mt-2 inline-flex rounded-full bg-cyan-950 px-2 py-1 text-xs font-semibold text-cyan-200">Контрольный замер подрядчика</span>}
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
                {selected.measurerUser?.role === "PARTNER" && <p className="mt-2 inline-flex rounded-full bg-cyan-950 px-2.5 py-1 text-xs font-semibold text-cyan-200">Контрольный замер подрядчика</p>}
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
                {measurer ? <div className="text-sm text-slate-300">Ответственный за замер<b className="mt-1 flex min-h-11 items-center rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">{selected.measurerUser?.name ?? "Текущий ответственный"}</b></div> : <Field label="Ответственный за замер"><select className={input} value={rescheduleMeasurerId} onChange={(event) => { setRescheduleMeasurerId(event.target.value); setRescheduleTravelApproved(false); }}><option value="">Выберите</option>{scheduleMeasurers.filter((row) => row.role !== "MEASURER" || measurerTerritoryMatch(row, selected.city).status !== "OUTSIDE_AREA").map((row) => <option key={row.id} value={row.id}>{row.name}{row.role === "DIRECTOR" ? " · основатель" : row.role === "OPERATIONS_DIRECTOR" ? " · директор" : ""}</option>)}</select></Field>}
                {!measurer && selectedRescheduleTerritory?.status === "APPROVAL_REQUIRED" && <label className="flex min-h-11 items-center gap-2 rounded-xl border border-amber-700 px-3 text-sm text-amber-100 sm:col-span-2"><input type="checkbox" checked={rescheduleTravelApproved} onChange={(event) => setRescheduleTravelApproved(event.target.checked)}/>Дальний выезд согласован с замерщиком</label>}
                <div className="flex gap-2 sm:col-span-2">
                  <button type="button" onClick={() => setRescheduleOpen(false)} className="min-h-11 flex-1 rounded-xl bg-slate-800 px-3">Отмена</button>
                  <button type="button" disabled={busy || !rescheduleDate || !rescheduleMeasurerId || (!measurer && selectedRescheduleTerritory?.status === "APPROVAL_REQUIRED" && !rescheduleTravelApproved)} onClick={() => void run({ action: "reschedule", visitDate: rescheduleDate, measurerUserId: Number(rescheduleMeasurerId), city: selected.city, address: selected.address, mapLink: selected.mapLink, comment: selected.managerComment, travelApproved: measurer || rescheduleTravelApproved }, "Замер перенесён").then(() => setRescheduleOpen(false))} className="min-h-11 flex-1 rounded-xl bg-amber-500 px-3 font-semibold text-slate-950 disabled:opacity-50">Сохранить</button>
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
              <p className="mt-2"><b className="text-white">Ответственный за замер:</b>{" "}{selected.measurerUser?.name ?? "не выбран"}</p>
              {selected.managerComment && (
                <p className="mt-2">
                  <b className="text-white">Комментарий:</b>{" "}
                  {selected.managerComment}
                </p>
              )}
            </div>
            {canSchedule && selected.client.orders.length > 0 && (
              <section className="rounded-xl border border-slate-700 bg-slate-950/60 p-4">
                <h3 className="font-semibold text-white">Привязка к действующему заказу</h3>
                <p className="mt-1 text-sm text-slate-400">После привязки замерный лист появится в заказе и в кабинете назначенного подрядчика.</p>
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <select className={input} value={linkOrderId} onChange={(event) => setLinkOrderId(event.target.value)}>
                    <option value="">Выберите заказ</option>
                    {selected.client.orders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.status}</option>)}
                  </select>
                  <button type="button" disabled={busy || !linkOrderId || Number(linkOrderId) === selected.order?.id} onClick={() => void run({ action: "link-order", orderId: Number(linkOrderId) }, "Замер привязан к заказу")} className="min-h-11 shrink-0 rounded-xl bg-blue-700 px-4 font-semibold disabled:opacity-50">Привязать</button>
                </div>
              </section>
            )}
            {canClaimSelected && (
              <button
                disabled={busy}
                onClick={() => void run({ action: "claim" }, "Замер назначен вам и добавлен в календарь")}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-50"
              >
                Взять свободный замер себе
              </button>
            )}
            {leadership && selected.measurerUser && !canPerformSelected && ["ASSIGNED", "IN_PROGRESS"].includes(selected.status) && (
              <p className="rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-300">Замер выполняет {selected.measurerUser.name}. Вы можете контролировать результат или переназначить ответственного через меню действий.</p>
            )}
            {canPerformSelected && selected.status === "ASSIGNED" && (
              <button
                disabled={busy}
                onClick={() => void run({ action: "start" }, "Замер начат")}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 font-semibold text-slate-950"
              >
                <Play size={18} />
                Начать замер
              </button>
            )}
            {canPerformSelected && selected.status === "IN_PROGRESS" && (
              <>
                <MeasurementDesignWorkflow
                  key={selected.id}
                  measurement={selected}
                  onChanged={async () => { await load(); }}
                />
                <section className="space-y-4 rounded-xl border border-blue-800/70 bg-blue-950/20 p-4">
                  <div><h3 className="font-semibold text-white">КП менеджера и окончательная цена</h3><p className="mt-1 text-sm text-slate-400">Выберите отправленное клиенту КП. Скидка уменьшит цену выбранного материала; после подтверждения ORDA сформирует новую версию КП.</p></div>
                  {!selected.client.commercialProposals.length ? <p className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">У клиента пока нет КП. Вы можете завершить замер с возвратом менеджеру, чтобы он подготовил расчёт.</p> : <>
                    <Field label="Исходное КП менеджера"><select className={input} value={quote.sourceProposalId} onChange={(event) => { const proposalId = event.target.value; const proposal = selected.client.commercialProposals.find((item) => item.id === Number(proposalId)); const first = proposal ? safeProposalVariants(proposal.snapshot)[0] : undefined; setQuote((current) => ({ ...current, sourceProposalId: proposalId, material: first?.material ?? "", discount: "0", confirmedWithClient: false })); }}><option value="">Выберите КП</option>{selected.client.commercialProposals.map((proposal) => <option key={proposal.id} value={proposal.id}>№{proposal.number} · {new Date(proposal.createdAt).toLocaleDateString("ru-RU")}</option>)}</select></Field>
                    {quote.sourceProposalId && <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Материал"><select className={input} value={quote.material} onChange={(event) => setQuote((current) => ({ ...current, material: event.target.value, discount: "0", confirmedWithClient: false }))}>{quoteVariants.map((variant) => <option key={variant.material} value={variant.material}>{variant.material} · {money(variant.total)}</option>)}</select></Field>
                      <Field label="Скидка на объекте, ₸"><input type="number" min="0" max={quoteVariant?.total ? quoteVariant.total - 1 : undefined} className={input} value={quote.discount} onChange={(event) => setQuote((current) => ({ ...current, discount: event.target.value, confirmedWithClient: false }))} /></Field>
                      <div className="rounded-xl bg-slate-950 p-3 text-sm text-slate-300"><span>Цена по КП</span><b className="mt-1 block text-lg text-white">{money(quoteVariant?.total ?? 0)}</b></div>
                      <div className="rounded-xl bg-emerald-950/50 p-3 text-sm text-emerald-200"><span>Окончательная цена</span><b className="mt-1 block text-lg text-white">{money(quoteFinalPrice)}</b></div>
                      <label className="sm:col-span-2 text-sm text-slate-300">Комментарий по цене<textarea rows={2} className={`${input} mt-1`} value={quote.comment} onChange={(event) => setQuote((current) => ({ ...current, comment: event.target.value }))} /></label>
                      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-emerald-800 px-3 text-sm text-emerald-100 sm:col-span-2"><input type="checkbox" checked={quote.confirmedWithClient} onChange={(event) => setQuote((current) => ({ ...current, confirmedWithClient: event.target.checked }))} />Окончательная сумма озвучена и согласована с клиентом</label>
                      <button type="button" disabled={busy || !quote.material || quoteFinalPrice <= 0} onClick={() => void run({ action: "save-quote", ...quotePayload() }, "Окончательная цена сохранена")} className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold disabled:opacity-50 sm:col-span-2">Сохранить цену без завершения замера</button>
                    </div>}
                  </>}
                </section>
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
                    ORDA сама сформирует PDF из заполненных размеров. Фото бумажного листа можно приложить дополнительно. Три ракурса объекта, референс и готовый эскиз добавляются в 3D-процессе выше.
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
                      onClick={() => choosePhoto("OPENING")}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-700 px-3 text-sm"
                    >
                      <Upload size={17} />
                      Фото проёма
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
                    disabled={busy || !clientOutcome || (clientOutcome === "READY_TO_CONTINUE" && (!quote.sourceProposalId || !quote.material || !quote.confirmedWithClient || quoteFinalPrice <= 0)) || (clientOutcome === "RETURN_TO_MANAGER" && !outcomeComment.trim()) || (clientOutcome === "REFUSED" && (!refusalReason || (refusalReason === "OTHER" && !outcomeComment.trim())))}
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
            {canPerformSelected && selected.status === "COMPLETED" && !selected.clientOutcome && (
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
            {canPerformSelected && selected.status === "HANDED_TO_MANAGER" && (
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
                : photo.type === "OPENING"
                  ? "Лестничный проём"
                  : photo.type === "OBJECT_FRONT"
                    ? "Объект — спереди"
                    : photo.type === "OBJECT_SIDE"
                      ? "Объект — сбоку"
                      : photo.type === "OBJECT_REAR"
                        ? "Объект — обратный ракурс"
                        : photo.type === "DESIGN_REFERENCE"
                          ? "Референс клиента"
                          : photo.type === "DESIGN_RESULT"
                            ? "Готовый 3D-эскиз"
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
      <div className="mt-4 rounded-xl border border-blue-900 bg-blue-950/20 p-3 text-sm text-slate-300">
        <div className="flex flex-wrap items-center justify-between gap-3"><b className="text-white">Замерный лист и окончательное КП</b><a href={`/api/measurements/${row.id}/sheet`} target="_blank" className="rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white">Открыть PDF замера</a></div>
        {row.quoteFinalPrice ? <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><span>Материал<b className="block text-white">{row.quoteMaterial || "—"}</b></span><span>Цена по КП<b className="block text-white">{money(Number(row.quoteBasePrice ?? 0))}</b></span><span>Скидка<b className="block text-white">{money(Number(row.quoteDiscount ?? 0))}</b></span><span>Итого<b className="block text-emerald-300">{money(Number(row.quoteFinalPrice))}</b></span></div> : <p className="mt-2 text-slate-400">Окончательная цена не фиксировалась.</p>}
        {row.finalProposal && <a href={`/api/proposals/${row.finalProposal.id}/pdf`} target="_blank" className="mt-3 inline-block font-semibold text-emerald-300">Окончательное КП №{row.finalProposal.number}</a>}
      </div>
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
