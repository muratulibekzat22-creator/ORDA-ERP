"use client";

import { ClipboardCopy, Download, Eye, File, Save, Sparkles, Trash2, Upload } from "lucide-react";
import { useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  ATTACHMENT_PURPOSES,
  attachmentPurposeLabel,
  buildDesignPrompt,
  type AttachmentPurpose,
  type DesignPromptSource,
} from "@/lib/orders/design-brief";

type Attachment = {
  id: number;
  fileName: string;
  contentType: string;
  purpose: AttachmentPurpose;
  size: number;
  createdAt: string;
  uploadedBy: { name: string } | null;
};

const allowed = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";
const control = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500 disabled:opacity-70";

export default function FilesTab({
  orderId,
  readOnly = false,
  brief,
}: {
  orderId: number;
  readOnly?: boolean;
  brief: DesignPromptSource;
}) {
  const { data: session } = useSession();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [selected, setSelected] = useState<File | null>(null);
  const [purpose, setPurpose] = useState<AttachmentPurpose>("CLIENT_SPACE");
  const [designStyle, setDesignStyle] = useState(brief.designStyle);
  const [designNotes, setDesignNotes] = useState(brief.designNotes);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canManage =
    !readOnly &&
    ["DIRECTOR", "OPERATIONS_DIRECTOR", "MANAGER"].includes(session?.user.role ?? "");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/attachments?orderId=${orderId}`, {
      cache: "no-store",
    });
    if (response.ok) setFiles((await response.json()) as Attachment[]);
    else
      setError(
        ((await response.json()) as { error?: string }).error ??
          "Не удалось загрузить файлы",
      );
    setLoading(false);
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveBrief() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ designStyle, designNotes }),
      });
      const body = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Не удалось сохранить 3D-бриф");
      setNotice("3D-бриф сохранён");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить 3D-бриф");
    } finally {
      setSaving(false);
    }
  }

  async function copyPrompt() {
    setError("");
    try {
      const prompt = buildDesignPrompt(
        { ...brief, designStyle, designNotes },
        files.map(({ fileName, purpose: filePurpose }) => ({ fileName, purpose: filePurpose })),
      );
      await navigator.clipboard.writeText(prompt);
      setNotice("Промпт скопирован. Добавьте в ChatGPT отмеченные фотографии.");
    } catch {
      setError("Не удалось скопировать промпт. Проверьте доступ браузера к буферу обмена.");
    }
  }

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true);
    setError("");
    setNotice("");
    const body = new FormData();
    body.set("orderId", String(orderId));
    body.set("purpose", purpose);
    body.set("file", selected);
    const response = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body,
    });
    if (response.ok) {
      setSelected(null);
      (event.currentTarget as HTMLFormElement).reset();
      setPurpose("CLIENT_SPACE");
      await load();
      setNotice("Файл добавлен в 3D-бриф");
    } else
      setError(
        ((await response.json()) as { error?: string }).error ??
          "Не удалось загрузить файл",
      );
    setSaving(false);
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить файл без возможности восстановления?")) return;
    setSaving(true);
    const response = await fetch(`/api/attachments?id=${id}`, {
      method: "DELETE",
    });
    if (response.ok) await load();
    else
      setError(
        ((await response.json()) as { error?: string }).error ??
          "Не удалось удалить файл",
      );
    setSaving(false);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-violet-500/30 bg-violet-500/5 p-4 sm:p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-xl bg-violet-500/15 p-2 text-violet-200"><Sparkles size={20} /></span>
          <div>
            <h2 className="text-lg font-bold text-white">Быстрый 3D-бриф</h2>
            <p className="mt-1 text-sm text-slate-400">Менеджер сохраняет стиль и пожелания, прикладывает три типа фото и копирует готовое задание в ChatGPT.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-slate-300">Стиль
            <select disabled={!canManage} value={designStyle} onChange={(event) => setDesignStyle(event.target.value)} className={control}>
              <option value="">Подобрать по фотографиям</option>
              <option>Классика</option>
              <option>Современный</option>
              <option>Минимализм</option>
              <option>Лофт</option>
              <option>Неоклассика</option>
            </select>
          </label>
          <label className="text-sm text-slate-300">Пожелания и дополнения
            <textarea disabled={!canManage} rows={3} value={designNotes} onChange={(event) => setDesignNotes(event.target.value)} placeholder="Что обязательно сохранить или добавить" className={`${control} py-3`} />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canManage ? <button type="button" disabled={saving} onClick={() => void saveBrief()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-violet-700 px-4 font-semibold text-white disabled:opacity-50"><Save size={17} />Сохранить бриф</button> : null}
          <button type="button" onClick={() => void copyPrompt()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-violet-500/50 bg-slate-950 px-4 font-semibold text-violet-100"><ClipboardCopy size={17} />Скопировать промпт для ChatGPT</button>
        </div>
      </section>

      {canManage && (
        <form onSubmit={upload} className="rounded-2xl border border-dashed border-slate-600 bg-[#101827] p-5">
          <h2 className="text-lg font-bold text-white">Добавить фото или файл</h2>
          <p className="mt-1 text-sm text-slate-400">Выберите назначение, чтобы фото автоматически попало в правильную часть 3D-брифа.</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[240px_minmax(0,1fr)_auto]">
            <select aria-label="Назначение файла" value={purpose} onChange={(event) => setPurpose(event.target.value as AttachmentPurpose)} className="min-h-11 rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">
              {ATTACHMENT_PURPOSES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <input required type="file" accept={allowed} disabled={saving} onChange={(event) => setSelected(event.target.files?.[0] ?? null)} className="min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white" />
            <button disabled={saving || !selected} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50"><Upload size={18} />{saving ? "Загрузка…" : "Загрузить"}</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">PDF, JPG, PNG, WEBP, Word и Excel · до 10 МБ · закрытое хранилище.</p>
        </form>
      )}

      {notice ? <p role="status" className="rounded-xl border border-emerald-700/50 bg-emerald-500/10 p-3 text-sm text-emerald-200">{notice}</p> : null}
      {error ? <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300">{error}</p> : null}

      <div className="rounded-2xl border border-slate-700 bg-[#101827]">
        <div className="border-b border-slate-700 p-5"><h2 className="text-xl font-bold text-white">Файлы заказа</h2></div>
        {loading ? <p className="p-6 text-slate-400">Загрузка…</p> : !files.length ? <p className="p-6 text-slate-400">Файлы ещё не загружены</p> : (
          <ul className="divide-y divide-slate-800">
            {files.map((item) => {
              const canPreview = item.contentType === "application/pdf" || item.contentType.startsWith("image/");
              return (
                <li key={item.id} className="flex flex-wrap items-center gap-4 p-5">
                  <File className="text-blue-400" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="truncate font-medium text-white">{item.fileName}</p><span className="rounded-full bg-violet-500/10 px-2 py-1 text-xs text-violet-200">{attachmentPurposeLabel(item.purpose)}</span></div>
                    <p className="mt-1 text-xs text-slate-400">{(item.size / 1024 / 1024).toFixed(2)} МБ · {item.uploadedBy?.name ?? "Удалённый пользователь"} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</p>
                  </div>
                  <div className="flex gap-2">
                    {canPreview ? <a title="Просмотр" target="_blank" rel="noreferrer" href={`/api/attachments/${item.id}?disposition=inline`} className="rounded-lg bg-slate-800 p-2 text-white hover:bg-slate-700"><Eye size={18} /></a> : null}
                    <a title="Скачать" href={`/api/attachments/${item.id}`} className="rounded-lg bg-blue-700 p-2 text-white hover:bg-blue-600"><Download size={18} /></a>
                    {canManage ? <button type="button" disabled={saving} title="Удалить" onClick={() => void remove(item.id)} className="rounded-lg bg-red-900 p-2 text-white hover:bg-red-800 disabled:opacity-50"><Trash2 size={18} /></button> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
