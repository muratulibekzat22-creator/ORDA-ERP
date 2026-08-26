"use client";

import { Camera, ExternalLink, Loader2, MessageSquareText, Upload, Video } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";

const statusLabels = {
  NEW: "Новый",
  NEED_CONTACT: "Нужно связаться",
  CONTACTED: "Связались",
  SHOOT_SCHEDULED: "Съёмка назначена",
  REVIEW_RECEIVED: "Отзыв получен",
  PHOTOS_RECEIVED: "Фото получены",
  VIDEO_RECEIVED: "Видео получено",
  CONTENT_READY: "Контент готов",
  PUBLISHED: "Опубликован",
  REFUSED: "Отказ",
} as const;

type Asset = {
  id: number;
  type: "PHOTO" | "VIDEO";
  fileName: string;
  contentType: string;
  size: number;
  createdAt: string;
};
type ContentTask = {
  id: number;
  status: keyof typeof statusLabels;
  contactConsent: string;
  photoVideoConsent: string;
  scheduledAt: string | null;
  reviewText: string | null;
  publicationUrl: string | null;
  comment: string | null;
  assignedMarketer: { id: number; name: string } | null;
  client: { id: number; name: string; phone: string; whatsapp: string; city: string; address: string };
  order: { id: number; number: string; address: string; staircase: string; material: string; completedAt: string | null; manager: string; managerUser: { name: string } | null };
  assets: Asset[];
};
type Payload = {
  metrics: {
    completedThisMonth: number;
    newTasks: number;
    needContact: number;
    overdueContact: number;
    shootsScheduled: number;
    waitingReview: number;
    waitingPhoto: number;
    waitingVideo: number;
    contentReady: number;
    published: number;
    refused: number;
    unassigned: number;
  };
  tasks: ContentTask[];
};

const control = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white";
const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white disabled:opacity-50";

export default function MarketingContentTasks({ initialFilter = "all" }: { initialFilter?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [activeFilter, setActiveFilter] = useState(initialFilter);
  const [now] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/marketing/content-tasks", { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить задачи");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить задачи");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function update(taskId: number, form: HTMLFormElement) {
    setBusy(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(form).entries());
      const response = await fetch("/api/marketing/content-tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId, ...values }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось сохранить задачу");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить задачу");
    } finally {
      setBusy(false);
    }
  }

  async function upload(taskId: number, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    if (!(file instanceof File) || !file.size) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      const response = await fetch(`/api/marketing/content-tasks/${taskId}/assets`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Файл не загружен");
      form.reset();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Файл не загружен");
    } finally {
      setBusy(false);
    }
  }

  if (!data && busy) return <div className="grid min-h-72 place-items-center text-slate-400"><Loader2 className="animate-spin" /></div>;
  if (!data) return <p className="rounded-xl border border-red-700/40 bg-red-950/30 p-4 text-red-200">{error || "Данные недоступны"}</p>;
  const metrics = [
    ["Сдано за месяц", data.metrics.completedThisMonth, "all"],
    ["Новые задачи", data.metrics.newTasks, "new"],
    ["Нужно связаться", data.metrics.needContact, "contact"],
    ["Просрочено", data.metrics.overdueContact, "overdue"],
    ["Съёмки", data.metrics.shootsScheduled, "shoot"],
    ["Ждут отзыв", data.metrics.waitingReview, "review"],
    ["Ждут фото", data.metrics.waitingPhoto, "photo"],
    ["Ждут видео", data.metrics.waitingVideo, "video"],
    ["Готово", data.metrics.contentReady, "ready"],
    ["Опубликовано", data.metrics.published, "published"],
    ["Без маркетолога", data.metrics.unassigned, "unassigned"],
  ] as const;
  const openTask = (task: ContentTask) => task.status !== "PUBLISHED" && task.status !== "REFUSED";
  const visibleTasks = data.tasks.filter((task) => {
    if (activeFilter === "new") return task.status === "NEW";
    if (activeFilter === "contact") return task.status === "NEW" || task.status === "NEED_CONTACT";
    if (activeFilter === "overdue") return openTask(task) && Boolean(task.scheduledAt && new Date(task.scheduledAt).getTime() < now);
    if (activeFilter === "shoot") return task.status === "SHOOT_SCHEDULED";
    if (activeFilter === "review") return openTask(task) && !task.reviewText;
    if (activeFilter === "photo") return openTask(task) && !task.assets.some((asset) => asset.type === "PHOTO");
    if (activeFilter === "video") return openTask(task) && !task.assets.some((asset) => asset.type === "VIDEO");
    if (activeFilter === "ready") return task.status === "CONTENT_READY";
    if (activeFilter === "published") return task.status === "PUBLISHED";
    if (activeFilter === "unassigned") return !task.assignedMarketer;
    return true;
  });
  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-red-700/40 bg-red-950/30 p-4 text-red-200">{error}</p>}
    <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">{metrics.map(([label, value, filter]) => <button type="button" onClick={() => setActiveFilter(filter)} key={label} className={`rounded-2xl border p-4 text-left ${activeFilter === filter ? "border-blue-500 bg-blue-950/30" : "border-slate-800 bg-slate-900/70"}`}><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><strong className="mt-2 block text-2xl text-white">{value}</strong></button>)}</section>
    {!visibleTasks.length ? <div className="rounded-2xl border border-dashed border-slate-700 p-10 text-center text-slate-400">По выбранному фильтру задач нет.</div> : <section className="grid min-w-0 gap-4 xl:grid-cols-2">{visibleTasks.map((task) => <article key={task.id} className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><p className="text-xs uppercase tracking-wide text-blue-300">{statusLabels[task.status] ?? task.status}</p><h3 className="mt-1 break-words text-lg font-bold text-white">{task.order.number} · {task.client.name}</h3><p className="mt-1 text-sm text-slate-400">{task.client.city} · {task.order.address || task.client.address}</p><p className="mt-1 text-sm text-slate-400">Менеджер: {task.order.managerUser?.name ?? task.order.manager}</p></div><div className="flex gap-2"><Link href={`/clients/${task.client.id}`} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-blue-300">Клиент</Link><Link href={`/orders/${task.order.id}`} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-blue-300">Заказ</Link></div></div>
      <div className="mt-4 grid gap-2 rounded-xl bg-slate-950/50 p-3 text-sm sm:grid-cols-2"><a href={`tel:${task.client.phone}`} className="text-blue-300">{task.client.phone}</a><a target="_blank" rel="noreferrer" href={`https://wa.me/${(task.client.whatsapp || task.client.phone).replace(/\D/g, "")}`} className="text-emerald-300">WhatsApp</a><span>Изделие: {task.order.staircase}</span><span>Материал: {task.order.material}</span><span>Контакт: {task.contactConsent === "YES" ? "разрешён" : task.contactConsent === "NO" ? "запрещён" : "не уточнён"}</span><span>Фото/видео: {task.photoVideoConsent === "YES" ? "разрешены" : task.photoVideoConsent === "NO" ? "запрещены" : "не уточнены"}</span></div>
      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void update(task.id, event.currentTarget); }}><label className="text-sm text-slate-300">Статус<select name="status" defaultValue={task.status} className={`mt-1 ${control}`}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm text-slate-300">Связаться / съёмка<input name="scheduledAt" type="datetime-local" defaultValue={task.scheduledAt ? new Date(task.scheduledAt).toISOString().slice(0, 16) : ""} className={`mt-1 ${control}`} /></label><label className="text-sm text-slate-300 sm:col-span-2">Отзыв<textarea name="reviewText" defaultValue={task.reviewText ?? ""} className={`mt-1 min-h-24 py-3 ${control}`} /></label><label className="text-sm text-slate-300">Ссылка на публикацию<input name="publicationUrl" defaultValue={task.publicationUrl ?? ""} className={`mt-1 ${control}`} /></label><label className="text-sm text-slate-300">Комментарий<input name="comment" defaultValue={task.comment ?? ""} className={`mt-1 ${control}`} /></label><button disabled={busy} className={`${button} sm:col-span-2`}>Сохранить задачу</button></form>
      <form onSubmit={(event) => void upload(task.id, event)} className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><input required name="file" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" className="min-w-0 rounded-xl border border-slate-700 bg-slate-950 p-2 text-sm text-slate-300 file:mr-2 file:rounded-lg file:border-0 file:bg-blue-700 file:px-3 file:py-2 file:text-white" /><button disabled={busy} className={button}><Upload size={17} /> Добавить фото / видео</button></form>
      {task.assets.length > 0 && <div className="mt-4 grid gap-2 sm:grid-cols-2">{task.assets.map((asset) => <a key={asset.id} target="_blank" rel="noreferrer" href={`/api/marketing/content-assets/${asset.id}`} className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-700 p-3 text-sm text-blue-300"><span className="shrink-0">{asset.type === "PHOTO" ? <Camera size={18} /> : <Video size={18} />}</span><span className="min-w-0 flex-1 truncate">{asset.fileName}</span><ExternalLink size={15} /></a>)}</div>}
      {task.reviewText && <p className="mt-4 flex gap-2 rounded-xl bg-blue-950/20 p-3 text-sm text-slate-200"><MessageSquareText size={18} className="shrink-0 text-blue-300" />{task.reviewText}</p>}
    </article>)}</section>}
  </div>;
}
