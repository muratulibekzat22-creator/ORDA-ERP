"use client";

import { Download, Eye, File, Trash2, Upload } from "lucide-react";
import { useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useState } from "react";

type Attachment = { id: number; fileName: string; contentType: string; size: number; createdAt: string; uploadedBy: { name: string } | null };
const allowed = ".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx";

export default function FilesTab({ orderId }: { orderId: number }) {
  const { data: session } = useSession();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [selected, setSelected] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canManage = session?.user.role === "DIRECTOR" || session?.user.role === "MANAGER";
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch(`/api/attachments?orderId=${orderId}`, { cache: "no-store" });
    if (response.ok) setFiles(await response.json() as Attachment[]);
    else setError((await response.json() as { error?: string }).error ?? "Не удалось загрузить файлы");
    setLoading(false);
  }, [orderId]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setSaving(true); setError("");
    const body = new FormData(); body.set("orderId", String(orderId)); body.set("file", selected);
    const response = await fetch("/api/attachments", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body });
    if (response.ok) { setSelected(null); (event.currentTarget as HTMLFormElement).reset(); await load(); }
    else setError((await response.json() as { error?: string }).error ?? "Не удалось загрузить файл");
    setSaving(false);
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить файл без возможности восстановления?")) return;
    setSaving(true);
    const response = await fetch(`/api/attachments?id=${id}`, { method: "DELETE" });
    if (response.ok) await load(); else setError((await response.json() as { error?: string }).error ?? "Не удалось удалить файл");
    setSaving(false);
  }

  return <div className="space-y-5">
    {canManage && <form onSubmit={upload} className="rounded-2xl border border-dashed border-slate-600 bg-[#101827] p-6">
      <h2 className="text-xl font-bold text-white">Загрузка файла</h2><p className="mt-2 text-sm text-slate-400">PDF, изображения, Word и Excel. Максимальный размер — 10 МБ. Файлы хранятся в закрытом хранилище.</p>
      <div className="mt-4 flex flex-wrap gap-3"><input required type="file" accept={allowed} disabled={saving} onChange={(event) => setSelected(event.target.files?.[0] ?? null)} className="min-w-64 flex-1 rounded-xl border border-slate-700 bg-slate-900 p-3 text-slate-300 file:mr-4 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"/><button disabled={saving || !selected} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"><Upload size={18}/>{saving ? "Загрузка…" : "Загрузить"}</button></div>
    </form>}
    {error && <p className="rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300">{error}</p>}
    <div className="rounded-2xl border border-slate-700 bg-[#101827]">
      <div className="border-b border-slate-700 p-5"><h2 className="text-xl font-bold text-white">Файлы заказа</h2></div>
      {loading ? <p className="p-6 text-slate-400">Загрузка…</p> : !files.length ? <p className="p-6 text-slate-400">Файлы ещё не загружены</p> : <ul className="divide-y divide-slate-800">{files.map((item) => { const canPreview = item.contentType === "application/pdf" || item.contentType.startsWith("image/"); return <li key={item.id} className="flex flex-wrap items-center gap-4 p-5"><File className="text-blue-400"/><div className="min-w-0 flex-1"><p className="truncate font-medium text-white">{item.fileName}</p><p className="mt-1 text-xs text-slate-400">{(item.size / 1024 / 1024).toFixed(2)} МБ · {item.uploadedBy?.name ?? "Удалённый пользователь"} · {new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.createdAt))}</p></div><div className="flex gap-2">{canPreview && <a title="Просмотр" target="_blank" rel="noreferrer" href={`/api/attachments/${item.id}?disposition=inline`} className="rounded-lg bg-slate-800 p-2 text-white hover:bg-slate-700"><Eye size={18}/></a>}<a title="Скачать" href={`/api/attachments/${item.id}`} className="rounded-lg bg-blue-700 p-2 text-white hover:bg-blue-600"><Download size={18}/></a>{canManage && <button disabled={saving} title="Удалить" onClick={() => void remove(item.id)} className="rounded-lg bg-red-900 p-2 text-white hover:bg-red-800 disabled:opacity-50"><Trash2 size={18}/></button>}</div></li>; })}</ul>}
    </div>
  </div>;
}
