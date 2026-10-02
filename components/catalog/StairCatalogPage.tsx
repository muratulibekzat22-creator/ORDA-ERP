"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { Download, Eye, Images, Search, X } from "lucide-react";

import { PRODUCT_CATALOG_REFERENCES } from "@/lib/design-catalog";

type CatalogCategory = "stairs" | "doors" | "furniture";
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
  category: CatalogCategory;
  title: string;
  material: string;
  note: string;
  tags: string[];
  imageUrl: string;
  downloadUrl: string;
  downloadFileName?: string;
  image: boolean;
};

const categoryLabels: Record<CatalogCategory, string> = {
  stairs: "Лестницы",
  doors: "Двери",
  furniture: "Мебель",
};

function categoryFromOrder(item: OrderCatalogItem): CatalogCategory {
  const text = `${item.order.staircase} ${item.order.material} ${item.fileName}`.toLocaleLowerCase("ru");
  if (text.includes("двер")) return "doors";
  if (/мебел|стол|стул|кресл|шкаф/.test(text)) return "furniture";
  return "stairs";
}

function asCatalogItem(item: OrderCatalogItem): CatalogItem {
  const category = categoryFromOrder(item);
  return {
    key: `order-${item.id}`,
    category,
    title: `${item.order.number} · ${item.order.staircase || categoryLabels[category]}`,
    material: item.order.material || item.fileName,
    note: "Фотография из заказа ALTYN SAPA",
    tags: [item.order.material, item.order.staircase].filter(Boolean),
    imageUrl: `/api/design-catalog/${item.id}`,
    downloadUrl: `/api/design-catalog/${item.id}?download=1`,
    image: item.contentType.startsWith("image/"),
  };
}

const references: CatalogItem[] = PRODUCT_CATALOG_REFERENCES.map((item) => ({
  key: item.id,
  category: item.category,
  title: item.title,
  material: item.material,
  note: item.note,
  tags: [...item.tags],
  imageUrl: item.publicUrl,
  downloadUrl: item.publicUrl,
  downloadFileName: item.downloadFileName,
  image: true,
}));

export default function StairCatalogPage() {
  const [items, setItems] = useState<CatalogItem[]>(references);
  const [category, setCategory] = useState<CatalogCategory>("stairs");
  const [tag, setTag] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<CatalogItem | null>(null);
  const [downloadBusy, setDownloadBusy] = useState(false);

  async function downloadCatalog() {
    setDownloadBusy(true); setError("");
    try {
      const response = await fetch("/api/design-catalog/download", { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? "Не удалось скачать каталог");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ALTYN-SAPA-product-catalog-${new Intl.DateTimeFormat("en-CA").format(new Date())}.zip`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось скачать каталог");
    } finally { setDownloadBusy(false); }
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/design-catalog", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => []);
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить каталог");
        const orderItems = (body as OrderCatalogItem[]).map(asCatalogItem).filter((item) => item.image);
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

  const categoryItems = useMemo(() => items.filter((item) => item.category === category), [category, items]);
  const tags = useMemo(() => [...new Set(categoryItems.flatMap((item) => item.tags).filter(Boolean))].slice(0, 10), [categoryItems]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ru");
    return categoryItems.filter((item) => {
      const searchable = `${item.title} ${item.material} ${item.note} ${item.tags.join(" ")}`.toLocaleLowerCase("ru");
      return (!needle || searchable.includes(needle)) && (!tag || item.tags.includes(tag));
    });
  }, [categoryItems, query, tag]);

  return <main className="space-y-4 p-4 pb-24 md:p-8">
    <header className="rounded-2xl border border-slate-800 bg-[#101827] p-5">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold text-blue-300">Для менеджера и замерщика</p><h1 className="mt-1 text-2xl font-bold md:text-3xl">Каталог изделий ALTYN SAPA</h1><p className="mt-2 max-w-2xl text-sm text-slate-400">Компактный выбор реальных материалов компании. Откройте нужное фото крупно или скачайте комплект перед выездом.</p></div><button type="button" onClick={() => void downloadCatalog()} disabled={downloadBusy} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold disabled:opacity-50"><Download size={18}/>{downloadBusy ? "Готовлю ZIP…" : "Скачать каталоги"}</button></div>
      <div className="mt-4 grid grid-cols-3 gap-2">{(Object.keys(categoryLabels) as CatalogCategory[]).map((value) => <button key={value} type="button" onClick={() => { setCategory(value); setTag(""); }} className={`min-h-11 rounded-xl px-3 text-sm font-semibold ${category === value ? "bg-blue-600 text-white" : "bg-slate-900 text-slate-300"}`}>{categoryLabels[value]} <span className="text-xs opacity-70">{items.filter((item) => item.category === value).length}</span></button>)}</div>
    </header>

    <div className="flex flex-col gap-2 md:flex-row"><label className="flex min-h-11 flex-1 items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-4 focus-within:border-blue-500"><Search size={18} className="text-slate-400"/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Материал, стиль, модель или заказ" className="min-w-0 flex-1 bg-transparent text-white outline-none placeholder:text-slate-500"/></label>{tags.length ? <div className="flex max-w-full gap-2 overflow-x-auto"><button type="button" onClick={() => setTag("")} className={`shrink-0 rounded-xl px-3 text-sm ${!tag ? "bg-slate-200 text-slate-950" : "bg-slate-900 text-slate-300"}`}>Все стили</button>{tags.map((value) => <button key={value} type="button" onClick={() => setTag(value)} className={`shrink-0 rounded-xl px-3 text-sm ${tag === value ? "bg-slate-200 text-slate-950" : "bg-slate-900 text-slate-300"}`}>{value}</button>)}</div> : null}</div>
    {error ? <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-3 text-sm text-red-200">{error}. Подготовленные карточки доступны ниже.</p> : null}
    {loading ? <p className="text-sm text-slate-400">Проверяю фотографии из заказов…</p> : null}

    {filtered.length ? <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">{filtered.map((item) => <article key={item.key} className="overflow-hidden rounded-2xl border border-slate-800 bg-[#101827]"><button type="button" onClick={() => setPreview(item)} className="group relative block w-full overflow-hidden bg-black" aria-label={`Открыть ${item.title}`}><Image src={item.imageUrl} alt={item.title} width={640} height={440} unoptimized className="h-44 w-full object-cover transition group-hover:scale-[1.02]"/><span className="absolute bottom-2 right-2 grid size-9 place-items-center rounded-full bg-black/75"><Eye size={16}/></span></button><div className="p-3"><h2 className="truncate font-semibold text-white">{item.title}</h2><p className="mt-1 line-clamp-2 text-xs text-slate-300">{item.material}</p><div className="mt-3 flex gap-2"><button type="button" onClick={() => setPreview(item)} className="min-h-10 flex-1 rounded-lg bg-slate-800 px-2 text-sm">Смотреть</button><a href={item.downloadUrl} download={item.downloadFileName} className="grid size-10 place-items-center rounded-lg bg-blue-600" aria-label={`Скачать ${item.title}`}><Download size={16}/></a></div></div></article>)}</section> : <div className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-slate-400"><Images className="mx-auto mb-3"/><b className="text-white">{category === "doors" ? "Каталог дверей готов к наполнению" : "По фильтру ничего не найдено"}</b><p className="mt-2 text-sm">{category === "doors" ? "Случайные фотографии из интернета не добавлялись. Реальные фото появятся здесь из заказов ORDA или после загрузки утверждённого набора." : "Сбросьте стиль или измените поисковый запрос."}</p></div>}

    {preview ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-3 md:p-8" role="dialog" aria-modal="true" aria-label={preview.title}><button type="button" onClick={() => setPreview(null)} aria-label="Закрыть" className="absolute right-4 top-4 grid size-12 place-items-center rounded-full bg-slate-900"><X/></button><div className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-950"><Image src={preview.imageUrl} alt={preview.title} width={1400} height={1000} unoptimized className="min-h-0 w-full flex-1 object-contain"/><div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 p-4"><div><b>{preview.title}</b><p className="text-sm text-slate-400">{preview.material}</p></div><a href={preview.downloadUrl} download={preview.downloadFileName} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold"><Download size={18}/>Скачать фото</a></div></div></div> : null}
  </main>;
}
