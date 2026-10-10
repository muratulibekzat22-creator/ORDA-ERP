"use client";

import { useSession } from "next-auth/react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type Supplier = { id: number; name: string; country: string; defaultCurrency: string; contact: string };
type Location = { id: number; name: string };
type AvailableOrder = { id: number; number: string; client: { name: string } };
type RequestRow = {
  id: number;
  quantityPairs: number;
  status: string;
  expectedArrivalDate: string | null;
  goodsCostKzt: number;
  cargoCostKzt: number;
  landedCostKzt: number;
  supplierPaidKzt: number;
  supplierBalanceKzt: number;
  cargoPaidKzt: number;
  cargoBalanceKzt: number;
  notes: string;
  photoUrl: string;
  order: { id: number; number: string; client: { name: string; phone: string } };
  supplier: { id: number; name: string; contact: string } | null;
  responsibleUser: { id: number; name: string };
  purchaseBatch: { id: number; number: string; status: string } | null;
  reminderTask: { id: number; dueAt: string; status: string } | null;
};
type WorkspacePayload = {
  procurements: RequestRow[];
  suppliers: Supplier[];
  locations: Location[];
  availableOrders: AvailableOrder[];
  error?: string;
};

const control = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";
const today = () => new Date().toISOString().slice(0, 10);
const future = () => new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const money = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₸`;
const labels: Record<string, string> = {
  REQUESTED: "Нужно заказать",
  ORDERED: "Заказано",
  IN_TRANSIT: "В пути",
  RECEIVED: "Получено",
  COST_FINALIZED: "Себестоимость рассчитана",
};

export default function BrassProcurementsPanel({
  canOperate,
  canPay,
  canAddSupplier,
  readOnly,
}: {
  canOperate: boolean;
  canPay: boolean;
  canAddSupplier: boolean;
  readOnly: boolean;
}) {
  const { data: session } = useSession();
  const userId = Number(session?.user.id ?? 0);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [availableOrders, setAvailableOrders] = useState<AvailableOrder[]>([]);
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [supplierForm, setSupplierForm] = useState({ name: "", country: "Казахстан", defaultCurrency: "KZT", contact: "" });
  const [requestForm, setRequestForm] = useState({ orderId: "", quantityPairs: "", notes: "" });
  const [requestPhoto, setRequestPhoto] = useState<File | null>(null);
  const [orderForm, setOrderForm] = useState({ supplierId: "", expectedArrivalDate: future(), purchaseCurrency: "KZT", exchangeRate: "1", unitPurchasePrice: "", notes: "" });
  const [payment, setPayment] = useState({ kind: "SUPPLIER", amount: "", method: "BANK_TRANSFER", paidAt: today(), comment: "" });
  const [receipt, setReceipt] = useState({ locationId: "", receivedAt: today(), cargoCostKzt: "", cargoProvider: "Карго", supplierDocumentNumber: "", note: "" });
  const actionLock = useRef(false);
  const pendingKeys = useRef(new Map<string, string>());
  const summary = useMemo(() => rows.reduce((total, row) => ({
    goods: total.goods + row.goodsCostKzt,
    cargo: total.cargo + row.cargoCostKzt,
    paid: total.paid + row.supplierPaidKzt + row.cargoPaidKzt,
    remaining: total.remaining + row.supplierBalanceKzt + row.cargoBalanceKzt,
  }), { goods: 0, cargo: 0, paid: 0, remaining: 0 }), [rows]);

  const load = useCallback(async () => {
    setMessage("");
    setLoading(true);
    try {
      const response = await fetch("/api/brass-procurements?workspace=1", {
        cache: "no-store",
      });
      const payload = await response.json() as WorkspacePayload;
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось загрузить закупки латуни");
      const requestRows = payload.procurements;
      const supplierRows = payload.suppliers;
      const locationRows = payload.locations;
      setRows(requestRows);
      setSuppliers(supplierRows);
      setLocations(locationRows);
      setAvailableOrders(payload.availableOrders);
      setSelected((current) => current ? requestRows.find((row) => row.id === current.id) ?? null : null);
      setOrderForm((current) => ({ ...current, supplierId: current.supplierId || String(supplierRows[0]?.id ?? ""), purchaseCurrency: current.purchaseCurrency || supplierRows[0]?.defaultCurrency || "KZT" }));
      setReceipt((current) => ({ ...current, locationId: current.locationId || String(locationRows[0]?.id ?? "") }));
      setRequestForm((current) => ({ ...current, orderId: current.orderId || String(payload.availableOrders[0]?.id ?? "") }));
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function action(body: Record<string, unknown>) {
    if (!selected || actionLock.current) return false;
    actionLock.current = true;
    setSaving(true);
    setMessage("");
    const signature = JSON.stringify({ procurementId: selected.id, ...body });
    const idempotencyKey = pendingKeys.current.get(signature) ?? crypto.randomUUID();
    pendingKeys.current.set(signature, idempotencyKey);
    try {
      const response = await fetch(`/api/brass-procurements/${selected.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify(body),
      });
      const payload = await response.json() as RequestRow & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Операция не выполнена");
      pendingKeys.current.delete(signature);
      setRows((current) => current.map((row) => row.id === payload.id ? payload : row));
      setSelected(payload);
      setMessage("Данные закупки обновлены");
      return true;
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Операция не выполнена");
      return false;
    } finally {
      actionLock.current = false;
      setSaving(false);
    }
  }

  async function placeOrder(event: FormEvent) {
    event.preventDefault();
    await action({ action: "order", ...orderForm, supplierId: Number(orderForm.supplierId), exchangeRate: Number(orderForm.exchangeRate), unitPurchasePrice: Number(orderForm.unitPurchasePrice) });
  }
  async function createRequest(event: FormEvent) {
    event.preventDefault();
    if (saving || !requestPhoto) return;
    const orderId = Number(requestForm.orderId);
    const signature = JSON.stringify({
      orderId,
      quantityPairs: requestForm.quantityPairs,
      notes: requestForm.notes,
      fileName: requestPhoto.name,
      size: requestPhoto.size,
      lastModified: requestPhoto.lastModified,
    });
    const idempotencyKey = pendingKeys.current.get(signature) ?? crypto.randomUUID();
    pendingKeys.current.set(signature, idempotencyKey);
    setSaving(true);
    setMessage("");
    try {
      const body = new FormData();
      body.set("quantityPairs", requestForm.quantityPairs);
      body.set("notes", requestForm.notes);
      body.set("photo", requestPhoto);
      const response = await fetch(`/api/orders/${orderId}/brass-procurement`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body,
      });
      const payload = await response.json() as RequestRow & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось создать заявку на латунь");
      pendingKeys.current.delete(signature);
      setRows((current) => [payload, ...current]);
      setSelected(payload);
      const nextOrders = availableOrders.filter((order) => order.id !== orderId);
      setAvailableOrders(nextOrders);
      setRequestForm({ orderId: String(nextOrders[0]?.id ?? ""), quantityPairs: "", notes: "" });
      setRequestPhoto(null);
      setMessage("Заявка на латунь создана");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не удалось создать заявку на латунь");
    } finally {
      setSaving(false);
    }
  }
  async function createSupplier(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/brass-procurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(supplierForm),
      });
      const payload = await response.json() as Supplier & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось добавить поставщика");
      setSuppliers((current) => [...current, payload].sort((a, b) => a.name.localeCompare(b.name, "ru")));
      setOrderForm((current) => ({ ...current, supplierId: String(payload.id), purchaseCurrency: payload.defaultCurrency }));
      setSupplierForm({ name: "", country: "Казахстан", defaultCurrency: "KZT", contact: "" });
      setMessage("Поставщик добавлен и выбран для этой закупки");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "Не удалось добавить поставщика");
    } finally {
      setSaving(false);
    }
  }
  async function pay(event: FormEvent) {
    event.preventDefault();
    if (await action({ action: "payment", ...payment, amount: Number(payment.amount) }))
      setPayment((current) => ({ ...current, amount: "", comment: "" }));
  }
  async function receive(event: FormEvent) {
    event.preventDefault();
    await action({ action: "receive", ...receipt, locationId: Number(receipt.locationId), cargoCostKzt: Number(receipt.cargoCostKzt || 0) });
  }

  return <div className="space-y-5">
    {message ? <p role="status" className="rounded-xl border border-blue-500/25 bg-blue-500/10 p-3 text-sm text-blue-100">{message}</p> : null}
    {readOnly ? <p className="rounded-xl border border-violet-500/25 bg-violet-500/10 p-3 text-sm text-violet-100"><strong>Режим основателя:</strong> полный обзор закупок и себестоимости без операционного ввода. Данные заполняют директор или ответственный менеджер.</p> : null}
    <section className="rounded-2xl border border-amber-500/25 bg-[#101827] p-5">
      <h2 className="text-xl font-bold text-white">Латунь под заказы</h2>
      <p className="mt-1 text-sm text-slate-400">Заявка менеджера → поставщик → оплата → контроль доставки → приёмка → карго → себестоимость заказа.</p>
      <details className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/5 p-4">
        <summary className="cursor-pointer font-semibold text-amber-100">+ Создать заявку на латунь</summary>
        <form onSubmit={createRequest} className="mt-4 grid gap-3 md:grid-cols-2">
          <select required value={requestForm.orderId} onChange={(event) => setRequestForm({ ...requestForm, orderId: event.target.value })} className={control}>
            <option value="">Выберите заказ</option>
            {availableOrders.map((order) => <option key={order.id} value={order.id}>{order.number} · {order.client.name}</option>)}
          </select>
          <input required type="number" min="1" max="10000" step="1" value={requestForm.quantityPairs} onChange={(event) => setRequestForm({ ...requestForm, quantityPairs: event.target.value })} placeholder="Количество пар" className={control} />
          <input required type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setRequestPhoto(event.target.files?.[0] ?? null)} className={`${control} py-2`} />
          <input value={requestForm.notes} onChange={(event) => setRequestForm({ ...requestForm, notes: event.target.value })} placeholder="Комментарий" className={control} />
          <button disabled={saving || !requestPhoto || !availableOrders.length} className="min-h-11 rounded-xl bg-amber-600 px-4 font-semibold text-white disabled:opacity-50 md:col-span-2">{saving ? "Создаём…" : "Создать заявку"}</button>
        </form>
        {!availableOrders.length && !loading ? <p className="mt-3 text-sm text-slate-400">Все активные заказы уже имеют заявку на латунь.</p> : null}
      </details>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"><Stat label="Заявок" value={String(rows.length)} /><Stat label="Товар" value={money(summary.goods)} /><Stat label="Карго" value={money(summary.cargo)} /><Stat label="Оплачено" value={money(summary.paid)} /><Stat label="Осталось" value={money(summary.remaining)} strong /></div>
      <div className="mt-4 space-y-3">
        {loading ? <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Загрузка заявок…</p> : null}
        {rows.map((row) => <button type="button" key={row.id} onClick={() => { setSelected(row); setOrderForm((current) => ({ ...current, notes: row.notes })); setMessage(""); }} className={`grid w-full gap-3 rounded-xl border p-4 text-left md:grid-cols-[1.2fr_0.7fr_1fr_1fr] ${selected?.id === row.id ? "border-amber-500/60 bg-amber-500/5" : "border-slate-800 bg-slate-950/55"}`}>
          <span><strong className="text-white">{row.order.number}</strong><small className="block text-slate-400">{row.order.client.name}</small></span>
          <span className="text-slate-200"><strong>{row.quantityPairs} пар</strong><small className="block text-slate-500">{labels[row.status] ?? row.status}</small></span>
          <span className="text-slate-300">{row.supplier?.name ?? "Поставщик не выбран"}<small className="block text-slate-500">{row.expectedArrivalDate ? `ожидается ${new Date(row.expectedArrivalDate).toLocaleDateString("ru-RU")}` : "срок не назначен"}</small></span>
          <span className="text-slate-300">{row.landedCostKzt > 0 ? money(row.landedCostKzt) : "Цена уточняется"}<small className="block text-slate-500">оплачено {money(row.supplierPaidKzt + row.cargoPaidKzt)}</small></span>
        </button>)}
        {!loading && !rows.length ? <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-slate-400">Заявок на латунь пока нет.</p> : null}
      </div>
    </section>
    {selected ? <section className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-amber-200">{labels[selected.status] ?? selected.status}</p><h3 className="text-2xl font-bold text-white">{selected.order.number} · {selected.quantityPairs} пар</h3><p className="mt-1 text-sm text-slate-400">Клиент: {selected.order.client.name} · ответственный: {selected.responsibleUser.name}</p></div><div className="flex gap-2"><a href={selected.photoUrl} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-blue-200">Фото</a><Link href={`/orders/${selected.order.id}`} className="rounded-xl border border-slate-700 px-3 py-2 text-sm text-blue-200">Заказ</Link></div></div>
      {selected.status === "REQUESTED" && canAddSupplier ? <details className="mt-5 rounded-xl border border-slate-800 bg-slate-950/35 p-4"><summary className="cursor-pointer font-semibold text-blue-200">+ Добавить нового поставщика</summary><form onSubmit={createSupplier} className="mt-4 grid gap-3 md:grid-cols-4"><input required value={supplierForm.name} onChange={(event) => setSupplierForm({ ...supplierForm, name: event.target.value })} placeholder="Название поставщика" className={control} /><input value={supplierForm.country} onChange={(event) => setSupplierForm({ ...supplierForm, country: event.target.value })} placeholder="Страна" className={control} /><input required value={supplierForm.defaultCurrency} onChange={(event) => setSupplierForm({ ...supplierForm, defaultCurrency: event.target.value.toUpperCase() })} placeholder="Валюта" className={control} /><input value={supplierForm.contact} onChange={(event) => setSupplierForm({ ...supplierForm, contact: event.target.value })} placeholder="Телефон / WhatsApp" className={control} /><button disabled={saving} className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold text-white disabled:opacity-50 md:col-span-4">{saving ? "Добавляем…" : "Добавить и выбрать поставщика"}</button></form></details> : null}
      {selected.status === "REQUESTED" && canOperate ? <form onSubmit={placeOrder} className="mt-5 grid gap-3 rounded-xl bg-slate-950/55 p-4 md:grid-cols-3">
        <h4 className="font-semibold text-white md:col-span-3">Оформить заказ поставщику</h4>
        <select required value={orderForm.supplierId} onChange={(event) => { const supplier = suppliers.find((item) => item.id === Number(event.target.value)); setOrderForm({ ...orderForm, supplierId: event.target.value, purchaseCurrency: supplier?.defaultCurrency ?? orderForm.purchaseCurrency }); }} className={control}><option value="">Поставщик</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select>
        <label className="text-xs text-slate-400">Обещанная дата доставки<input required type="date" min={today()} value={orderForm.expectedArrivalDate} onChange={(event) => setOrderForm({ ...orderForm, expectedArrivalDate: event.target.value })} className={`${control} mt-1`} /></label>
        <input required type="number" min="0.01" step="any" value={orderForm.unitPurchasePrice} onChange={(event) => setOrderForm({ ...orderForm, unitPurchasePrice: event.target.value })} placeholder={`Цена за пару, ${orderForm.purchaseCurrency}`} className={control} />
        <input required value={orderForm.purchaseCurrency} onChange={(event) => setOrderForm({ ...orderForm, purchaseCurrency: event.target.value.toUpperCase() })} placeholder="Валюта" className={control} />
        <input required type="number" min="0.000001" step="any" value={orderForm.exchangeRate} onChange={(event) => setOrderForm({ ...orderForm, exchangeRate: event.target.value })} placeholder="Курс к тенге" className={control} />
        <input value={orderForm.notes} onChange={(event) => setOrderForm({ ...orderForm, notes: event.target.value })} placeholder="Комментарий поставщику" className={control} />
        <button disabled={saving || !suppliers.length || !userId} className="min-h-11 rounded-xl bg-amber-600 px-4 font-semibold text-white disabled:opacity-50 md:col-span-3">{saving ? "Оформляем…" : "Заказать и создать контроль за 3 дня"}</button>
      </form> : null}
      {["ORDERED", "IN_TRANSIT"].includes(selected.status) ? <div className="mt-5 space-y-4">
        <div className="grid gap-3 rounded-xl bg-slate-950/55 p-4 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Товар" value={money(selected.goodsCostKzt)} /><Stat label="Оплачено поставщику" value={money(selected.supplierPaidKzt)} /><Stat label="Осталось поставщику" value={money(selected.supplierBalanceKzt)} /><Stat label="Доставка" value={selected.expectedArrivalDate ? new Date(selected.expectedArrivalDate).toLocaleDateString("ru-RU") : "—"} /></div>
        {selected.status === "ORDERED" && canOperate ? <button type="button" disabled={saving} onClick={() => void action({ action: "in_transit" })} className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold text-white">Поставщик отправил · отметить «В пути»</button> : null}
        {canPay ? <form onSubmit={pay} className="grid gap-3 rounded-xl border border-slate-800 p-4 sm:grid-cols-2 lg:grid-cols-5"><h4 className="font-semibold text-white sm:col-span-2 lg:col-span-5">Записать оплату поставщику</h4><input required type="number" min="0.01" max={selected.supplierBalanceKzt} step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value, kind: "SUPPLIER" })} placeholder="Сумма" className={control} /><input required type="date" value={payment.paidAt} onChange={(event) => setPayment({ ...payment, paidAt: event.target.value })} className={control} /><input required value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} placeholder="Способ оплаты" className={control} /><input value={payment.comment} onChange={(event) => setPayment({ ...payment, comment: event.target.value })} placeholder="Комментарий" className={control} /><button disabled={saving || selected.supplierBalanceKzt <= 0} className="rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50">Сохранить оплату</button></form> : null}
        {canOperate ? <form onSubmit={receive} className="grid gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:grid-cols-2 lg:grid-cols-4"><h4 className="font-semibold text-emerald-100 sm:col-span-2 lg:col-span-4">Принять латунь и рассчитать полную себестоимость</h4><select required value={receipt.locationId} onChange={(event) => setReceipt({ ...receipt, locationId: event.target.value })} className={control}><option value="">Место хранения</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select><input required type="date" value={receipt.receivedAt} onChange={(event) => setReceipt({ ...receipt, receivedAt: event.target.value })} className={control} /><input type="number" min="0" step="0.01" value={receipt.cargoCostKzt} onChange={(event) => setReceipt({ ...receipt, cargoCostKzt: event.target.value })} placeholder="Сумма карго, ₸" className={control} /><input value={receipt.cargoProvider} onChange={(event) => setReceipt({ ...receipt, cargoProvider: event.target.value })} placeholder="Карго / перевозчик" className={control} /><input value={receipt.supplierDocumentNumber} onChange={(event) => setReceipt({ ...receipt, supplierDocumentNumber: event.target.value })} placeholder="Номер документа поставщика" className={control} /><input value={receipt.note} onChange={(event) => setReceipt({ ...receipt, note: event.target.value })} placeholder="Комментарий приёмки" className={`${control} lg:col-span-2`} /><button disabled={saving || !locations.length} className="min-h-11 rounded-xl bg-emerald-700 px-4 font-semibold text-white disabled:opacity-50 lg:col-span-4">{saving ? "Принимаем…" : "Получено · принять на склад и посчитать себестоимость"}</button></form> : null}
      </div> : null}
      {selected.status === "COST_FINALIZED" ? <div className="mt-5 space-y-4"><div className="grid gap-3 rounded-xl bg-slate-950/55 p-4 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Товар" value={money(selected.goodsCostKzt)} /><Stat label="Карго" value={money(selected.cargoCostKzt)} /><Stat label="Полная себестоимость" value={money(selected.landedCostKzt)} strong /><Stat label="Не оплачено" value={money(selected.supplierBalanceKzt + selected.cargoBalanceKzt)} /></div>{canPay && selected.supplierBalanceKzt > 0 ? <form onSubmit={pay} className="grid gap-3 rounded-xl border border-slate-800 p-4 sm:grid-cols-2 lg:grid-cols-5"><h4 className="font-semibold text-white sm:col-span-2 lg:col-span-5">Доплатить поставщику</h4><input required type="number" min="0.01" max={selected.supplierBalanceKzt} step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value, kind: "SUPPLIER" })} placeholder="Сумма" className={control} /><input required type="date" value={payment.paidAt} onChange={(event) => setPayment({ ...payment, paidAt: event.target.value })} className={control} /><input required value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} placeholder="Способ оплаты" className={control} /><input value={payment.comment} onChange={(event) => setPayment({ ...payment, comment: event.target.value })} placeholder="Комментарий" className={control} /><button disabled={saving} className="rounded-xl bg-emerald-700 px-4 font-semibold text-white">Сохранить доплату</button></form> : null}{canPay && selected.cargoBalanceKzt > 0 ? <form onSubmit={pay} className="grid gap-3 rounded-xl border border-slate-800 p-4 sm:grid-cols-2 lg:grid-cols-5"><h4 className="font-semibold text-white sm:col-span-2 lg:col-span-5">Записать оплату карго</h4><input required type="number" min="0.01" max={selected.cargoBalanceKzt} step="0.01" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value, kind: "CARGO" })} placeholder="Сумма" className={control} /><input required type="date" value={payment.paidAt} onChange={(event) => setPayment({ ...payment, paidAt: event.target.value })} className={control} /><input required value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} placeholder="Способ оплаты" className={control} /><input value={payment.comment} onChange={(event) => setPayment({ ...payment, comment: event.target.value })} placeholder="Комментарий" className={control} /><button disabled={saving} className="rounded-xl bg-emerald-700 px-4 font-semibold text-white">Сохранить оплату</button></form> : null}</div> : null}
    </section> : null}
  </div>;
}

function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) { return <div><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 ${strong ? "text-lg font-bold text-emerald-200" : "font-semibold text-white"}`}>{value}</p></div>; }
