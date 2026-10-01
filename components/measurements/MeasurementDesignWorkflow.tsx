"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import {
  Camera,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  Images,
  Save,
  Sparkles,
  Upload,
} from "lucide-react";

import ChatGptOfficeAccessCard from "@/components/training/ChatGptOfficeAccessCard";
import { buildMeasurementDesignPrompt } from "@/lib/orders/design-brief";

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
  city: string;
  address: string;
  designStyle: string;
  designNotes: string;
  designPromptCopiedAt?: string | null;
  designShownAt?: string | null;
  client: { name: string };
  attachments: Photo[];
};
type CatalogItem = {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  purpose: string;
  createdAt: string;
  order: { number: string; staircase: string; material: string };
};

const photoSteps = [
  ["OBJECT_FRONT", "Спереди", "Снимите всю лестницу и проём целиком"],
  ["OBJECT_SIDE", "Сбоку", "Покажите марш, высоту и примыкания"],
  ["OBJECT_REAR", "Обратный ракурс", "Снимите заднюю часть и сложные узлы"],
] as const;
const control = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none focus:border-violet-500";

export default function MeasurementDesignWorkflow({
  measurement,
  onChanged,
}: {
  measurement: Measurement;
  onChanged: () => Promise<void>;
}) {
  const [style, setStyle] = useState(measurement.designStyle ?? "");
  const [notes, setNotes] = useState(measurement.designNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const photosOf = (type: string) =>
    measurement.attachments.filter((photo) => photo.type === type);
  const legacyObjectPhotos = photosOf("OBJECT").length;
  const anglesReady =
    legacyObjectPhotos >= 3 || photoSteps.every(([type]) => photosOf(type).length > 0);
  const referenceReady = photosOf("DESIGN_REFERENCE").length > 0;
  const promptReady = Boolean(measurement.designPromptCopiedAt);
  const resultReady = photosOf("DESIGN_RESULT").length > 0;
  const shownReady = Boolean(measurement.designShownAt);
  const completed = [anglesReady, referenceReady, promptReady, resultReady, shownReady].filter(Boolean).length;

  async function upload(type: string, file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setMessage("");
    const form = new FormData();
    form.set("file", file);
    form.set("type", type);
    const response = await fetch(`/api/measurements/${measurement.id}/attachments`, {
      method: "POST",
      body: form,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось загрузить фотографию");
    else {
      setMessage(type === "DESIGN_RESULT" ? "Готовый эскиз сохранён" : "Фотография сохранена");
      await onChanged();
    }
    setBusy(false);
  }

  async function save(event?: "PROMPT_COPIED" | "SHOWN_TO_CLIENT") {
    setBusy(true);
    setError("");
    setMessage("");
    const response = await fetch(`/api/measurements/${measurement.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "design-workflow",
        designStyle: style,
        designNotes: notes,
        event,
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось сохранить 3D-процесс");
    else {
      setMessage(
        event === "PROMPT_COPIED"
          ? "Промпт скопирован — добавьте в ChatGPT фотографии из замера"
          : event === "SHOWN_TO_CLIENT"
            ? "Зафиксировано: визуализация показана клиенту"
            : "Пожелания клиента сохранены",
      );
      await onChanged();
    }
    setBusy(false);
    return response.ok;
  }

  async function copyPrompt() {
    if (!anglesReady || !referenceReady) {
      setError("Сначала добавьте три ракурса объекта и референс клиента");
      return;
    }
    const prompt = buildMeasurementDesignPrompt(
      {
        measurementId: measurement.id,
        clientName: measurement.client.name,
        city: measurement.city,
        address: measurement.address,
        designStyle: style,
        designNotes: notes,
      },
      measurement.attachments.map(({ fileName, type }) => ({ fileName, type })),
    );
    try {
      await navigator.clipboard.writeText(prompt);
      await save("PROMPT_COPIED");
    } catch {
      setError("Не удалось скопировать промпт. Разрешите браузеру доступ к буферу обмена.");
    }
  }

  async function openCatalog() {
    const next = !catalogOpen;
    setCatalogOpen(next);
    if (!next || catalog.length) return;
    setCatalogLoading(true);
    setError("");
    const response = await fetch("/api/design-catalog", { cache: "no-store" });
    const body = await response.json().catch(() => []);
    if (!response.ok) setError(body.error ?? "Не удалось открыть каталог");
    else setCatalog(body as CatalogItem[]);
    setCatalogLoading(false);
  }

  async function selectCatalogItem(id: number) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/design-catalog/${id}/use`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ measurementId: measurement.id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось выбрать работу");
    else {
      setMessage("Работа из каталога добавлена как референс клиента");
      setCatalogOpen(false);
      await onChanged();
    }
    setBusy(false);
  }

  return (
    <section className="rounded-2xl border border-violet-500/40 bg-violet-950/10 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-violet-500/15 p-2 text-violet-200"><Sparkles size={21} /></span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-violet-300">Обязательный сценарий</p>
            <h3 className="mt-1 text-lg font-bold text-white">3D-проект прямо во время замера</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">Сфотографируйте объект, выберите с клиентом дизайн, получите готовый промпт и покажите итоговый эскиз до завершения встречи.</p>
          </div>
        </div>
        <span className="rounded-full bg-slate-950 px-3 py-2 text-sm font-bold text-violet-200">{completed}/5 шагов</span>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-violet-500" style={{ width: `${completed * 20}%` }} /></div>

      <div className="mt-5 space-y-4">
        <Step number={1} title="Три ракурса лестницы" done={anglesReady}>
          <div className="grid gap-3 sm:grid-cols-3">
            {photoSteps.map(([type, title, hint]) => {
              const ready = photosOf(type).length > 0 || legacyObjectPhotos >= 3;
              return <label key={type} className={`relative cursor-pointer rounded-xl border p-3 ${ready ? "border-emerald-700 bg-emerald-950/20" : "border-slate-700 bg-slate-950"}`}><span className="flex items-center gap-2 font-semibold text-white">{ready ? <CheckCircle2 size={18} className="text-emerald-400" /> : <Camera size={18} className="text-blue-300" />}{title}</span><span className="mt-1 block text-xs text-slate-400">{hint}</span><input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => { void upload(type, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>;
            })}
          </div>
        </Step>

        <Step number={2} title="Какую лестницу хочет клиент" done={referenceReady}>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-300">Стиль
              <select className={control} value={style} onChange={(event) => setStyle(event.target.value)}>
                <option value="">Определить по референсу</option><option>Классика</option><option>Современный</option><option>Минимализм</option><option>Лофт</option><option>Неоклассика</option>
              </select>
            </label>
            <label className="text-sm text-slate-300">Пожелания клиента
              <textarea rows={3} className={`${control} py-3`} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Цвет, материал, перила, подсветка, обшивка и важные детали" />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void save()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 font-semibold text-white disabled:opacity-50"><Save size={17} />Сохранить пожелания</button>
            <button type="button" disabled={busy} onClick={() => void openCatalog()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-500/50 bg-slate-950 px-4 font-semibold text-violet-100"><Images size={18} />Каталог наших работ</button>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-blue-600 bg-blue-950/30 px-4 font-semibold text-blue-100"><Upload size={17} />Загрузить референс клиента<input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { void upload("DESIGN_REFERENCE", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          </div>
          {catalogOpen && <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-3"><h4 className="font-semibold text-white">Каталог ALTYN SAPA</h4><div className="flex flex-wrap gap-2"><Link href="/catalog" target="_blank" className="inline-flex items-center gap-1 rounded-lg bg-violet-800 px-3 py-2 text-sm text-white"><Images size={15}/>Открыть весь каталог</Link><Link href="/api/design-catalog/download" prefetch={false} className="inline-flex items-center gap-1 rounded-lg bg-blue-700 px-3 py-2 text-sm text-white"><Download size={15}/>Скачать ZIP</Link><a href="https://www.instagram.com/altyn_sapa.company/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-2 text-sm text-blue-300">Instagram <ExternalLink size={15} /></a></div></div>
            {catalogLoading ? <p className="mt-3 text-sm text-slate-400">Загрузка каталога…</p> : catalog.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{catalog.map((item) => <article key={item.id} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">{item.contentType.startsWith("image/") ? <a href={`/api/design-catalog/${item.id}`} target="_blank" rel="noreferrer" title="Открыть крупно"><Image src={`/api/design-catalog/${item.id}`} alt={item.fileName} width={360} height={220} unoptimized className="h-40 w-full object-cover" /></a> : <video controls preload="metadata" className="h-40 w-full bg-black"><source src={`/api/design-catalog/${item.id}`} type={item.contentType} /></video>}<div className="p-3"><p className="truncate text-sm font-semibold text-white">{item.order.number} · {item.order.staircase || "Лестница"}</p><p className="mt-1 truncate text-xs text-slate-400">{item.order.material || item.fileName}</p><div className="mt-3 flex gap-2">{item.contentType.startsWith("image/") && <button type="button" disabled={busy} onClick={() => void selectCatalogItem(item.id)} className="min-h-10 flex-1 rounded-lg bg-violet-700 px-2 text-xs font-semibold">Выбрать</button>}{item.contentType.startsWith("image/") && <a href={`/api/design-catalog/${item.id}`} target="_blank" rel="noreferrer" className="flex min-h-10 items-center justify-center rounded-lg bg-slate-700 px-3 text-xs font-semibold" title="Открыть крупно">Открыть</a>}<a href={`/api/design-catalog/${item.id}?download=1`} className="flex min-h-10 items-center justify-center rounded-lg bg-slate-700 px-3" title="Скачать"><Download size={16} /></a></div></div></article>)}</div> : <p className="mt-3 rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">Реальных фотографий из заказов пока нет. Откройте отдельный каталог — там уже доступен визуальный пример ALTYN SAPA. Работы, отмеченные менеджером как «Референс из наших работ», автоматически появятся здесь.</p>}
          </div>}
        </Step>

        <Step number={3} title="Готовый промпт для ChatGPT" done={promptReady}>
          <p className="text-sm text-slate-400">Промпт сохраняет реальную геометрию объекта, переносит только стиль референса и добавляет фирменный водяной знак ALTYN SAPA.</p>
          <div className="mt-3"><ChatGptOfficeAccessCard compact /></div>
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || !anglesReady || !referenceReady} onClick={() => void copyPrompt()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-700 px-4 font-semibold disabled:opacity-40"><ClipboardCopy size={17} />Скопировать готовый промпт</button><a href="https://chatgpt.com/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-600 px-4 font-semibold text-slate-200">Открыть ChatGPT <ExternalLink size={16} /></a></div>
          <div className="mt-3 flex flex-wrap gap-2">{measurement.attachments.filter((photo) => ["OBJECT_FRONT", "OBJECT_SIDE", "OBJECT_REAR", "OBJECT", "DESIGN_REFERENCE"].includes(photo.type)).map((photo) => <a key={photo.id} href={`/api/measurement-attachments/${photo.id}?download=1`} className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-slate-800 px-3 text-xs text-blue-200"><Download size={14} />{photo.fileName}</a>)}</div>
        </Step>

        <Step number={4} title="Загрузите готовую визуализацию" done={resultReady}>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl bg-violet-700 px-4 font-semibold"><Upload size={17} />Загрузить готовый 3D-эскиз<input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(event) => { void upload("DESIGN_RESULT", event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
          {photosOf("DESIGN_RESULT").map((photo) => <a key={photo.id} href={`/api/measurement-attachments/${photo.id}`} target="_blank" rel="noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-violet-700 bg-slate-950"><Image src={`/api/measurement-attachments/${photo.id}`} alt="Готовая визуализация" width={800} height={450} unoptimized className="max-h-96 w-full object-contain" /></a>)}
        </Step>

        <Step number={5} title="Покажите эскиз клиенту" done={shownReady}>
          <p className="text-sm text-slate-400">Откройте готовый эскиз на телефоне или планшете, покажите клиенту и зафиксируйте результат.</p>
          <button type="button" disabled={busy || !resultReady || shownReady} onClick={() => void save("SHOWN_TO_CLIENT")} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold disabled:opacity-40"><CheckCircle2 size={18} />{shownReady ? "Показано клиенту" : "Подтвердить: показал клиенту"}</button>
        </Step>
      </div>

      {message && <p role="status" className="mt-4 rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">{message}</p>}
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
    </section>
  );
}

function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: React.ReactNode }) {
  return <article className={`rounded-xl border p-4 ${done ? "border-emerald-800/70 bg-emerald-950/10" : "border-slate-700 bg-slate-900/70"}`}><div className="flex items-center gap-2"><span className={`flex size-7 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-emerald-600 text-white" : "bg-slate-700 text-slate-200"}`}>{done ? <CheckCircle2 size={17} /> : number}</span><h4 className="font-semibold text-white">{title}</h4></div><div className="mt-3">{children}</div></article>;
}
