"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  ExternalLink,
  Eye,
  Images,
  Search,
  X,
} from "lucide-react";

import { STAIR_CATALOG_REFERENCES } from "@/lib/design-catalog";

type OrderCatalogItem = {
  id: number;
  fileName: string;
  contentType: string;
  size: number;
  purpose: string;
  createdAt: string;
  order: { number: string; staircase: string; material: string };
};

type CatalogItem = {
  key: string;
  title: string;
  material: string;
  note: string;
  imageUrl: string;
  downloadUrl: string;
  downloadFileName?: string;
  sourceUrl?: string;
  image: boolean;
};

function asCatalogItem(item: OrderCatalogItem): CatalogItem {
  return {
    key: `order-${item.id}`,
    title: `${item.order.number} · ${item.order.staircase || "Лестница"}`,
    material: item.order.material || item.fileName,
    note: "Фотография из заказа ALTYN SAPA",
    imageUrl: `/api/design-catalog/${item.id}`,
    downloadUrl: `/api/design-catalog/${item.id}?download=1`,
    image: item.contentType.startsWith("image/"),
  };
}

const references: CatalogItem[] = STAIR_CATALOG_REFERENCES.map((item) => ({
  key: item.id,
  title: item.title,
  material: item.material,
  note: item.note,
  imageUrl: item.publicUrl,
  downloadUrl: item.publicUrl,
  downloadFileName: item.downloadFileName,
  sourceUrl: "sourceUrl" in item ? item.sourceUrl : undefined,
  image: true,
}));

export default function StairCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>(references);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<CatalogItem | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  async function downloadCatalog() {
    setDownloadBusy(true);
    setError("");
    try {
      const response = await fetch("/api/design-catalog/download", {
        cache: "no-store",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Не удалось скачать каталог");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ALTYN-SAPA-stair-catalog-${new Intl.DateTimeFormat("en-CA").format(new Date())}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось скачать каталог");
    } finally {
      setDownloadBusy(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/design-catalog", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = await response.json().catch(() => []);
        if (!response.ok)
          throw new Error(body.error ?? "Не удалось загрузить каталог");
        const orderItems = (body as OrderCatalogItem[])
          .map(asCatalogItem)
          .filter((item) => item.image);
        setItems([...references, ...orderItems]);
      })
      .catch((reason) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить каталог");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setPreview(null);
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [preview]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    if (!needle) return items;
    return items.filter((item) =>
      `${item.title} ${item.material} ${item.note}`
        .toLocaleLowerCase("ru")
        .includes(needle),
    );
  }, [items, query]);

  return (
    <main className="space-y-5 p-4 pb-24 md:p-8">
      <header className="rounded-2xl border border-slate-800 bg-[#101827] p-5 md:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-300">Для встречи с клиентом</p>
            <h1 className="mt-1 text-2xl font-bold md:text-3xl">Каталог лестниц ALTYN SAPA</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400">
              Откройте фотографию на весь экран или скачайте комплект заранее — он будет доступен даже при слабом интернете.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void downloadCatalog()}
            disabled={downloadBusy}
            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-blue-600 px-5 font-semibold text-white hover:bg-blue-500"
          >
            <Download size={19} /> {downloadBusy ? "Готовлю ZIP…" : "Скачать весь каталог ZIP"}
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href="https://www.instagram.com/altyn_sapa.company/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-200"
          >
            Instagram ALTYN SAPA <ExternalLink size={16} />
          </a>
          <span className="inline-flex min-h-11 items-center rounded-xl bg-slate-900 px-4 text-sm text-slate-300">
            {items.length} фото доступно
          </span>
        </div>
      </header>

      <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 focus-within:border-blue-500">
        <Search size={19} className="text-slate-400" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти по материалу, стилю или номеру заказа"
          className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-slate-500"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-200">
          {error}. Подготовленные фотографии всё равно доступны ниже.
        </p>
      )}
      {loading && <p className="text-sm text-slate-400">Загружаю фотографии из заказов…</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filtered.map((item) => (
          <article key={item.key} className="overflow-hidden rounded-2xl border border-slate-800 bg-[#101827]">
            <button
              type="button"
              onClick={() => setPreview(item)}
              className="group relative block w-full overflow-hidden bg-black"
              aria-label={`Открыть ${item.title}`}
            >
              <Image
                src={item.imageUrl}
                alt={item.title}
                width={720}
                height={560}
                unoptimized
                className="h-64 w-full object-cover transition duration-200 group-hover:scale-[1.02]"
              />
              <span className="absolute inset-x-3 bottom-3 inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-black/75 px-3 text-sm font-semibold text-white backdrop-blur">
                <Eye size={17} /> Открыть крупно
              </span>
            </button>
            <div className="p-4">
              <h2 className="font-semibold text-white">{item.title}</h2>
              <p className="mt-1 text-sm text-slate-300">{item.material}</p>
              <p className="mt-2 text-xs text-slate-500">{item.note}</p>
              {item.sourceUrl && (
                <a
                  href={item.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-blue-300 hover:text-blue-200"
                >
                  Официальная публикация <ExternalLink size={13} />
                </a>
              )}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(item)}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 text-sm font-semibold"
                >
                  <Eye size={17} /> Смотреть
                </button>
                <a
                  href={item.downloadUrl}
                  download={item.downloadFileName}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 text-sm font-semibold"
                >
                  <Download size={17} /> Скачать
                </a>
              </div>
            </div>
          </article>
        ))}
      </section>
      {!loading && filtered.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400">
          <Images className="mx-auto mb-3" /> По этому запросу фотографий нет.
        </div>
      )}

      {preview && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 md:p-8" role="dialog" aria-modal="true" aria-label={preview.title}>
          <button type="button" onClick={() => setPreview(null)} aria-label="Закрыть" className="absolute right-4 top-4 grid size-12 place-items-center rounded-full bg-slate-900 text-white"><X /></button>
          <div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950">
            <Image src={preview.imageUrl} alt={preview.title} width={1400} height={1000} unoptimized className="min-h-0 w-full flex-1 object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4">
              <div><b>{preview.title}</b><p className="text-sm text-slate-400">{preview.material}</p></div>
              <a href={preview.downloadUrl} download={preview.downloadFileName} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold"><Download size={18}/>Скачать фото</a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

