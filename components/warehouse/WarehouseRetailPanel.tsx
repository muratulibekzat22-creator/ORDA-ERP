"use client";

import { Role } from "@prisma/client";
import { ArrowRightLeft, ImageOff, PackageCheck, Plus, ShoppingCart, X } from "lucide-react";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useState } from "react";

export type RetailMaterial = {
  id: number;
  name: string;
  code?: string | null;
  color?: string | null;
  finish?: string | null;
  dimensions?: string | null;
  variantGroup?: string | null;
  unit: string;
  stock: number;
  reserved: number;
  available: number | null;
  availabilityLabel?: string;
  quantityKnown?: boolean;
  quantityPrecision?: number;
  sellingPrice?: string | null;
  purchasePrice?: string | null;
  photoUrl?: string | null;
  active: boolean;
  balances?: Array<{ stock: string; reserved: string; location: { id: number; name: string; address: string } }>;
};

type Location = { id: number; name: string; address: string; isDefault: boolean; access: Array<{ canSell: boolean; canReceive: boolean; canAdjust: boolean }> };
type SaleLine = { materialId: number; quantity: string; discount: string };
type PaymentPart = { method: string; amount: string; reference: string };
type ClientOption = { id: number; name: string; phone: string; city: string };

const methods = ["Наличные", "Kaspi перевод", "Kaspi рассрочка", "Банковская карта", "Банковский перевод", "Другое"];
const money = (value: string | number | null | undefined) => value == null || value === "" ? "Цена не задана" : `${Number(value).toLocaleString("ru-RU")} ₸`;

export default function WarehouseRetailPanel({ materials, role, onRefresh }: { materials: RetailMaterial[]; role?: Role; onRefresh: () => Promise<void> | void }) {
  const variants = useMemo(() => materials.filter((item) => item.variantGroup === "MINI_SPIGOT_200" && item.active), [materials]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [saleItem, setSaleItem] = useState<RetailMaterial | null>(null);
  const [factsOpen, setFactsOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [message, setMessage] = useState("");
  const readOnly = role === Role.DIRECTOR;
  const canFill = role === Role.OPERATIONS_DIRECTOR;
  useEffect(() => {
    let active = true;
    void fetch("/api/warehouse/locations", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error();
      return response.json() as Promise<{ locations: Location[] }>;
    }).then((value) => { if (active) setLocations(value.locations); }).catch(() => { if (active) setMessage("Не удалось загрузить места хранения"); });
    return () => { active = false; };
  }, []);
  if (!variants.length) return null;
  return (
    <section className="rounded-2xl border border-blue-500/25 bg-[#101827] p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Подтверждённые варианты</p>
          <h2 className="mt-1 text-xl font-bold text-white">Мини-стойки для стеклянного ограждения, 200 мм</h2>
          <p className="mt-1 text-sm text-slate-400">Количество и цены показываются только из фактически сохранённых данных.</p>
        </div>
        {canFill ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setFactsOpen(true)} className="min-h-11 rounded-xl bg-amber-600 px-4 py-2 font-semibold text-white">Заполнить остатки и цены</button><button type="button" disabled={locations.length < 2} onClick={() => setTransferOpen(true)} className="flex min-h-11 items-center gap-2 rounded-xl bg-slate-700 px-4 py-2 font-semibold text-white disabled:opacity-50"><ArrowRightLeft size={17} />Переместить</button></div> : null}
      </div>
      {message ? <p role="status" className="mt-4 rounded-xl bg-slate-900 p-3 text-sm text-slate-300">{message}</p> : null}
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {variants.map((item) => <article key={item.id} className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/45">
          <ProductImage item={item} />
          <div className="p-4">
            <p className="text-xs text-slate-500">{item.code || "Артикул не задан"}</p>
            <h3 className="mt-1 font-semibold text-white">{item.color}{item.finish ? ` · ${item.finish}` : ""}</h3>
            <p className="mt-2 text-lg font-bold text-emerald-300">{money(item.sellingPrice)}</p>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
              <Stock label="Физически" value={item.quantityKnown ? item.stock : "—"} />
              <Stock label="Резерв" value={item.quantityKnown ? item.reserved : "—"} />
              <Stock label="Доступно" value={item.available ?? "—"} />
            </dl>
            <p className="mt-3 min-h-9 text-xs text-slate-400">{item.availabilityLabel}</p>
            {!readOnly ? <button type="button" disabled={item.sellingPrice == null || item.available == null || item.available <= 0} onClick={() => setSaleItem(item)} className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-3 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"><ShoppingCart size={17} />Продать</button> : null}
          </div>
        </article>)}
      </div>
      {factsOpen ? <FactsDialog variants={variants} locations={locations} onClose={() => setFactsOpen(false)} onSaved={async () => { setFactsOpen(false); setMessage("Фактические остатки и цены сохранены"); await onRefresh(); }} /> : null}
      {transferOpen ? <TransferDialog materials={materials.filter((item) => item.active && item.quantityKnown)} locations={locations} onClose={() => setTransferOpen(false)} onSaved={async (number) => { setTransferOpen(false); setMessage(`Перемещение ${number} проведено`); await onRefresh(); }} /> : null}
      {saleItem ? <SaleDialog initial={saleItem} materials={materials.filter((item) => item.active)} locations={locations} allowDiscount={canFill} onClose={() => setSaleItem(null)} onSaved={async (text) => { setSaleItem(null); setMessage(text); await onRefresh(); }} /> : null}
    </section>
  );
}

function ProductImage({ item, compact = false }: { item: RetailMaterial; compact?: boolean }) {
  return item.photoUrl
    ? <Image src={item.photoUrl} alt={`${item.name}, ${item.color ?? "вариант"}`} width={640} height={480} unoptimized className="aspect-[4/3] w-full bg-white object-contain" />
    : <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 bg-slate-900 px-2 text-center text-xs text-slate-500"><ImageOff size={compact ? 20 : 28} /><span>{compact ? "Нет фото" : "Фото не загружено"}</span></div>;
}

function Stock({ label, value }: { label: string; value: string | number }) {
  return <div><dt className="text-slate-500">{label}</dt><dd className="mt-1 font-semibold text-white">{value}</dd></div>;
}

function DialogShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end bg-black/70 sm:items-center sm:justify-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
    <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-4 shadow-2xl sm:max-w-3xl sm:rounded-2xl sm:p-6">
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-[#101827] pb-3"><h2 className="text-xl font-bold text-white">{title}</h2><button type="button" onClick={onClose} className="min-h-11 min-w-11 rounded-xl bg-slate-800 text-slate-300" aria-label="Закрыть"><X className="mx-auto" /></button></div>
      {children}
    </div>
  </div>;
}

function FactsDialog({ variants, locations, onClose, onSaved }: { variants: RetailMaterial[]; locations: Location[]; onClose: () => void; onSaved: () => void | Promise<void> }) {
  const [locationId, setLocationId] = useState(String(locations.find((item) => item.isDefault)?.id ?? locations[0]?.id ?? ""));
  const [rows, setRows] = useState(() => variants.map((item) => ({ materialId: item.id, quantity: item.quantityKnown ? String(item.stock) : "", purchasePrice: item.purchasePrice ?? "", sellingPrice: item.sellingPrice ?? "" })));
  const [photos, setPhotos] = useState<Record<number, File | undefined>>({});
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/warehouse/opening-stock", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ locationId: Number(locationId), rows }) });
      if (!response.ok) throw new Error(((await response.json()) as { error?: string }).error || "Не удалось сохранить");
      for (const [materialId, photo] of Object.entries(photos)) {
        if (!photo) continue;
        const data = new FormData();
        data.set("file", photo);
        const upload = await fetch(`/api/warehouse/${materialId}/photo`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: data });
        if (!upload.ok) throw new Error(((await upload.json()) as { error?: string }).error || "Не удалось сохранить фотографию");
      }
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось сохранить"); } finally { setSaving(false); }
  }
  return <DialogShell title="Заполнить остатки и цены" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-sm text-slate-300">Место хранения<select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white"><option value="">Выберите место</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <div className="space-y-3">{rows.map((row, index) => <div key={row.materialId} className="grid gap-3 rounded-xl border border-slate-700 p-3 sm:grid-cols-[8rem_1fr_1fr_1fr]">
      <div><ProductImage item={variants[index]} /><label className="mt-2 block cursor-pointer text-xs text-blue-300">{photos[row.materialId] ? photos[row.materialId]?.name : "Выбрать фото"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotos({ ...photos, [row.materialId]: event.target.files?.[0] })} className="sr-only" /></label></div>
      <label className="text-xs text-slate-400">Количество<input type="number" min="0" step="1" value={row.quantity} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} className="mt-1 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" placeholder="Не введено" /></label>
      <label className="text-xs text-slate-400">Себестоимость, ₸<input type="number" min="0" step="0.01" value={row.purchasePrice} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, purchasePrice: event.target.value } : item))} className="mt-1 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" placeholder="Не введена" /></label>
      <label className="text-xs text-slate-400">Цена продажи, ₸<input type="number" min="0" step="0.01" value={row.sellingPrice} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, sellingPrice: event.target.value } : item))} className="mt-1 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" placeholder="Не введена" /></label>
      <p className="text-sm font-semibold text-white sm:col-span-4">{variants[index].color}{variants[index].finish ? ` · ${variants[index].finish}` : ""}</p>
    </div>)}</div>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <button disabled={saving || !locationId} className="min-h-12 w-full rounded-xl bg-amber-600 font-semibold text-white disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить фактические данные"}</button>
  </form></DialogShell>;
}

function TransferDialog({ materials, locations, onClose, onSaved }: { materials: RetailMaterial[]; locations: Location[]; onClose: () => void; onSaved: (number: string) => void | Promise<void> }) {
  const [materialId, setMaterialId] = useState(String(materials[0]?.id ?? ""));
  const [fromLocationId, setFromLocationId] = useState(String(locations[0]?.id ?? ""));
  const [toLocationId, setToLocationId] = useState(String(locations.find((item) => String(item.id) !== String(locations[0]?.id))?.id ?? ""));
  const [quantity, setQuantity] = useState(""), [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const material = materials.find((item) => item.id === Number(materialId));
  const sourceBalance = material?.balances?.find((item) => item.location.id === Number(fromLocationId));
  const available = sourceBalance ? Number(sourceBalance.stock) - Number(sourceBalance.reserved) : 0;
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch("/api/warehouse/transfers", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ materialId: Number(materialId), fromLocationId: Number(fromLocationId), toLocationId: Number(toLocationId), quantity: Number(quantity), reason }),
      });
      const value = await response.json() as { error?: string; result?: { number?: string }; number?: string };
      if (!response.ok) throw new Error(value.error || "Не удалось провести перемещение");
      await onSaved(value.result?.number ?? value.number ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось провести перемещение"); } finally { setSaving(false); }
  }
  return <DialogShell title="Перемещение между местами хранения" onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <label className="block text-sm text-slate-300">Товар<select required value={materialId} onChange={(event) => setMaterialId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white"><option value="">Выберите товар</option>{materials.map((item) => <option key={item.id} value={item.id}>{item.name}{item.color ? ` · ${item.color}` : ""} · {item.code}</option>)}</select></label>
    <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm text-slate-300">Откуда<select required value={fromLocationId} onChange={(event) => setFromLocationId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white">{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="text-sm text-slate-300">Куда<select required value={toLocationId} onChange={(event) => setToLocationId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white">{locations.map((item) => <option key={item.id} value={item.id} disabled={String(item.id) === fromLocationId}>{item.name}</option>)}</select></label></div>
    <p className="text-sm text-slate-400">Доступно в месте отправления: <strong className="text-white">{available.toLocaleString("ru-RU")} {material?.unit ?? ""}</strong></p>
    <label className="block text-sm text-slate-300">Количество<input required type="number" min={material?.quantityPrecision ? "0.001" : "1"} max={available || undefined} step={material?.quantityPrecision ? "0.001" : "1"} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white" /></label>
    <label className="block text-sm text-slate-300">Причина<textarea required maxLength={1000} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-xl bg-slate-900 p-3 text-white" placeholder="Например: перемещение в шоурум" /></label>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <button disabled={saving || !materialId || !fromLocationId || !toLocationId || fromLocationId === toLocationId || available <= 0} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50"><ArrowRightLeft size={18} />{saving ? "Проведение…" : "Провести перемещение"}</button>
  </form></DialogShell>;
}

function SaleDialog({ initial, materials, locations, allowDiscount, onClose, onSaved }: { initial: RetailMaterial; materials: RetailMaterial[]; locations: Location[]; allowDiscount: boolean; onClose: () => void; onSaved: (message: string) => void | Promise<void> }) {
  const [locationId, setLocationId] = useState(String(locations.find((item) => item.isDefault)?.id ?? locations[0]?.id ?? ""));
  const [lines, setLines] = useState<SaleLine[]>([{ materialId: initial.id, quantity: "1", discount: "0" }]);
  const [clientMode, setClientMode] = useState<"walkIn" | "existing" | "new">("walkIn");
  const [clientSearch, setClientSearch] = useState(""), [clients, setClients] = useState<ClientOption[]>([]), [clientId, setClientId] = useState("");
  const [newClient, setNewClient] = useState({ name: "", phone: "", city: "Алматы", address: "" });
  const initialTotal = Number(initial.sellingPrice ?? 0);
  const [takePayment, setTakePayment] = useState(true), [paymentAmount, setPaymentAmount] = useState(initialTotal > 0 ? String(initialTotal) : "");
  const [parts, setParts] = useState<PaymentPart[]>([{ method: "Kaspi перевод", amount: initialTotal > 0 ? String(initialTotal) : "", reference: "" }]);
  const [issueNow, setIssueNow] = useState(false), [recipientName, setRecipientName] = useState("");
  const [saving, setSaving] = useState(false), [error, setError] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const total = useMemo(() => lines.reduce((sum, line) => {
    const item = materials.find((value) => value.id === line.materialId);
    return sum + Number(item?.sellingPrice ?? 0) * Number(line.quantity || 0) - Number(line.discount || 0);
  }, 0), [lines, materials]);
  function fillPaymentTotal() {
    const amount = total.toFixed(2);
    setPaymentAmount(amount);
    if (parts.length === 1) setParts([{ ...parts[0], amount }]);
  }
  useEffect(() => {
    if (clientMode !== "existing" || clientSearch.trim().length < 2) {
      const clearTimer = window.setTimeout(() => setClients([]), 0);
      return () => window.clearTimeout(clearTimer);
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => void fetch(`/api/clients?compact=true&limit=8&search=${encodeURIComponent(clientSearch)}`, { cache: "no-store", signal: controller.signal }).then((response) => response.json()).then((value: { data?: ClientOption[] }) => setClients(value.data ?? [])).catch(() => undefined), 250);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [clientMode, clientSearch]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const payload = {
        locationId: Number(locationId),
        ...(clientMode === "walkIn" ? { walkIn: true } : clientMode === "existing" ? { clientId: Number(clientId) } : { client: newClient }),
        items: lines.map((line) => ({ materialId: line.materialId, quantity: Number(line.quantity), discount: Number(line.discount || 0) })),
        payment: takePayment ? { amount: Number(paymentAmount), parts: parts.map((part) => ({ method: part.method, amount: Number(part.amount), reference: part.reference || undefined })) } : undefined,
        issueNow,
        recipientName: recipientName || undefined,
      };
      const response = await fetch("/api/warehouse/sales", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify(payload) });
      const value = await response.json() as { error?: string; orderId?: number; receiptPdfStatus?: string; invoicePdfStatus?: string };
      if (!response.ok) throw new Error(value.error || "Не удалось провести продажу");
      await onSaved(`Продажа проведена. Заказ №${value.orderId}${takePayment ? " · квитанция сформирована" : ""}${issueNow ? " · накладная сформирована" : " · товар зарезервирован"}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось провести продажу"); } finally { setSaving(false); }
  }
  return <DialogShell title="Продажа со склада" onClose={onClose}><form onSubmit={submit} className="space-y-5">
    <label className="block text-sm text-slate-300">Место выдачи<select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white"><option value="">Выберите место</option>{locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <section><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-white">Товары</h3><button type="button" disabled={lines.length >= materials.length} onClick={() => setLines([...lines, { materialId: materials.find((item) => !lines.some((line) => line.materialId === item.id))?.id ?? initial.id, quantity: "1", discount: "0" }])} className="flex min-h-10 items-center gap-2 rounded-lg bg-slate-800 px-3 text-sm text-white disabled:cursor-not-allowed disabled:opacity-40"><Plus size={16} />Добавить</button></div>
      <div className="mt-3 space-y-3">{lines.map((line, index) => {
        const selected = materials.find((item) => item.id === line.materialId) ?? initial;
        return <div key={index} className="grid gap-2 rounded-xl border border-slate-700 p-3 sm:grid-cols-[5rem_minmax(0,1fr)_7rem_8rem_2.75rem] sm:items-center">
        <div className="w-20 overflow-hidden rounded-lg"><ProductImage item={selected} compact /></div>
        <select value={line.materialId} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, materialId: Number(event.target.value) } : item))} className="min-h-11 min-w-0 rounded-lg bg-slate-900 px-3 text-white">{materials.map((item) => <option key={item.id} value={item.id} disabled={lines.some((row, i) => i !== index && row.materialId === item.id)}>{item.name} · {item.color ?? "вариант"} · {money(item.sellingPrice)}</option>)}</select>
        <input required type="number" min={(materials.find((item) => item.id === line.materialId)?.quantityPrecision ?? 0) > 0 ? "0.001" : "1"} step={(materials.find((item) => item.id === line.materialId)?.quantityPrecision ?? 0) > 0 ? "0.001" : "1"} value={line.quantity} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))} className="min-h-11 rounded-lg bg-slate-900 px-3 text-white" aria-label="Количество" />
        <input type="number" min="0" step="0.01" disabled={!allowDiscount} value={line.discount} onChange={(event) => setLines(lines.map((item, i) => i === index ? { ...item, discount: event.target.value } : item))} className="min-h-11 rounded-lg bg-slate-900 px-3 text-white disabled:cursor-not-allowed disabled:opacity-60" aria-label="Скидка" placeholder={allowDiscount ? "Скидка" : "Скидка недоступна"} />
        <button type="button" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, i) => i !== index))} className="min-h-11 rounded-lg bg-red-950 text-red-300 disabled:opacity-30" aria-label="Удалить позицию"><X className="mx-auto" size={17} /></button>
      </div>;})}</div><p className="mt-3 text-right text-lg font-bold text-white">Итого: {money(total)}</p>
    </section>
    <section><h3 className="font-semibold text-white">Покупатель</h3><div className="mt-2 grid grid-cols-3 gap-2">{(["walkIn", "existing", "new"] as const).map((mode) => <button key={mode} type="button" onClick={() => setClientMode(mode)} className={`min-h-11 rounded-lg px-2 text-sm ${clientMode === mode ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}>{mode === "walkIn" ? "Розничный" : mode === "existing" ? "Найти" : "Новый"}</button>)}</div>
      {clientMode === "existing" ? <div className="mt-3"><input value={clientSearch} onChange={(event) => setClientSearch(event.target.value)} placeholder="Имя или телефон" className="min-h-11 w-full rounded-xl bg-slate-900 px-3 text-white" /><div className="mt-2 space-y-1">{clients.map((client) => <button key={client.id} type="button" onClick={() => setClientId(String(client.id))} className={`w-full rounded-lg p-3 text-left text-sm ${clientId === String(client.id) ? "bg-blue-900 text-white" : "bg-slate-900 text-slate-300"}`}>{client.name} · {client.phone} · {client.city}</button>)}</div></div> : null}
      {clientMode === "new" ? <div className="mt-3 grid gap-2 sm:grid-cols-2">{(["name", "phone", "city", "address"] as const).map((field) => <input key={field} required={field !== "address"} value={newClient[field]} onChange={(event) => setNewClient({ ...newClient, [field]: event.target.value })} placeholder={{ name: "Имя", phone: "Телефон", city: "Город", address: "Адрес" }[field]} className="min-h-11 rounded-xl bg-slate-900 px-3 text-white" />)}</div> : null}
    </section>
    <section className="rounded-xl bg-slate-950/50 p-4"><label className="flex min-h-11 items-center gap-3 text-white"><input type="checkbox" checked={takePayment} onChange={(event) => setTakePayment(event.target.checked)} />Принять оплату сейчас</label>{takePayment ? <div className="mt-3 space-y-2"><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input required type="number" min="0.01" max={total} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className="min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" placeholder="Сумма оплаты" /><button type="button" onClick={fillPaymentTotal} className="min-h-11 rounded-lg bg-slate-800 px-3 text-sm text-white">Вся сумма</button></div>{parts.map((part, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_9rem_2.75rem]"><select value={part.method} onChange={(event) => setParts(parts.map((item, i) => i === index ? { ...item, method: event.target.value } : item))} className="min-h-11 rounded-lg bg-slate-900 px-3 text-white">{methods.map((method) => <option key={method}>{method}</option>)}</select><input required type="number" min="0.01" step="0.01" value={part.amount} onChange={(event) => setParts(parts.map((item, i) => i === index ? { ...item, amount: event.target.value } : item))} className="min-h-11 rounded-lg bg-slate-900 px-3 text-white" aria-label="Сумма по способу оплаты" /><button type="button" disabled={parts.length === 1} onClick={() => setParts(parts.filter((_, i) => i !== index))} className="min-h-11 rounded-lg bg-red-950 text-red-300 disabled:opacity-30" aria-label="Удалить способ оплаты"><X className="mx-auto" size={17} /></button></div>)}<button type="button" onClick={() => setParts([...parts, { method: "Наличные", amount: "", reference: "" }])} className="min-h-10 rounded-lg bg-slate-800 px-3 text-sm text-white">Смешанная оплата: добавить способ</button></div> : null}</section>
    <section className="rounded-xl bg-slate-950/50 p-4"><label className="flex min-h-11 items-center gap-3 text-white"><input type="checkbox" checked={issueNow} onChange={(event) => setIssueNow(event.target.checked)} />Выдать товар сейчас</label>{issueNow ? <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Получатель (если отличается)" className="mt-2 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white" /> : <p className="mt-1 text-xs text-slate-400">Товар будет зарезервирован. В заказе появится действие «Выдать товар».</p>}</section>
    {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
    <button disabled={saving || !locationId || (clientMode === "existing" && !clientId)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50"><PackageCheck size={18} />{saving ? "Проведение…" : "Провести продажу"}</button>
  </form></DialogShell>;
}
