"use client";

import { DocumentStatus, DocumentType } from "@prisma/client";
import { ExternalLink, FileCheck2, FileText, FolderUp, Plus, Receipt, Upload, X } from "lucide-react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { FormEvent, useCallback, useDeferredValue, useEffect, useState } from "react";

import { documentStatusLabels, documentTabs, documentTypeLabels } from "@/lib/document-meta";
import ContractComposer, { type GeneratedContract } from "@/components/contracts/ContractComposer";

type Entity = { id: number; name?: string; phone?: string; number?: string; client?: { id: number; name: string; phone?: string } };
type PaymentOption = { id: number; orderId: number; amount: string | number; method: string; operationDate: string; comment?: string | null };
type DocumentItem = { id: number | string; recordKind: string; type: DocumentType; number: string; title: string; documentDate: string; status: DocumentStatus; source: string; currentVersion: number; client: { id: number; name: string; phone: string } | null; order: { id: number; number: string } | null; payment?: { id: number; amount: string | number; method: string; operationDate: string; type: string } | null; author: { id: number; name: string } | null; openHref: string };
type Options = { clients: Entity[]; orders: Entity[]; payments: PaymentOption[]; authors: Entity[]; allowedTypes: DocumentType[] };
const today = () => new Date().toISOString().slice(0, 10);
type DocumentForm = { clientId: string; orderId: string; type: DocumentType; title: string; number: string; documentDate: string; comment: string };
const emptyForm: DocumentForm = { clientId: "", orderId: "", type: DocumentType.CONTRACT, title: "", number: "", documentDate: today(), comment: "" };
const control = "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-white outline-none focus:border-blue-500";
type Workflow = "" | "chooser" | "contract" | "signed" | "payment" | "upload";

export default function DocumentsPage({ initialOrderId, initialClientId, embedded = false }: { initialOrderId?: number; initialClientId?: number; embedded?: boolean } = {}) {
  const { data: session } = useSession();
  const [items, setItems] = useState<DocumentItem[]>([]), [options, setOptions] = useState<Options>({ clients: [], orders: [], payments: [], authors: [], allowedTypes: [] });
  const [query, setQuery] = useState(""), deferredQuery = useDeferredValue(query);
  const [type, setType] = useState<"" | DocumentType>(""), [status, setStatus] = useState<"" | DocumentStatus>(""), [authorId, setAuthorId] = useState(""), [from, setFrom] = useState(""), [to, setTo] = useState("");
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [generated, setGenerated] = useState<GeneratedContract | null>(null), [workflow, setWorkflow] = useState<Workflow>(""), [orderQuery, setOrderQuery] = useState(""), [contractOrderId, setContractOrderId] = useState<number | null>(null), [signedContracts, setSignedContracts] = useState<DocumentItem[]>([]), [form, setForm] = useState<DocumentForm>({ ...emptyForm, orderId: initialOrderId ? String(initialOrderId) : "", clientId: initialClientId ? String(initialClientId) : "" }), [file, setFile] = useState<File | null>(null);
  const [paymentId, setPaymentId] = useState(""), [paymentAmount, setPaymentAmount] = useState(""), [paymentDate, setPaymentDate] = useState(today()), [paymentMethod, setPaymentMethod] = useState("");
  const [orderResults, setOrderResults] = useState<Entity[]>([]), deferredOrderQuery = useDeferredValue(orderQuery);
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  const canUpload = ["DIRECTOR", "MANAGER", "ACCOUNTANT"].includes(session?.user.role ?? "");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    params.set("page", String(page)); params.set("limit", "50");
    if (initialOrderId) params.set("orderId", String(initialOrderId));
    if (initialClientId) params.set("clientId", String(initialClientId));
    if (deferredQuery.trim()) params.set("q", deferredQuery.trim());
    if (type) params.set("type", type); if (status) params.set("status", status); if (authorId) params.set("authorId", authorId); if (from) params.set("from", new Date(`${from}T00:00:00`).toISOString()); if (to) params.set("to", new Date(`${to}T23:59:59.999`).toISOString());
    setLoading(true); setError("");
    try { const response = await fetch(`/api/documents?${params}`, { cache: "no-store" }); const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Не удалось загрузить документы"); setItems(payload.data ?? []); setHasMore(Boolean(payload.pagination?.hasMore)); }
    catch (next) { setError(next instanceof Error ? next.message : "Не удалось загрузить документы"); }
    finally { setLoading(false); }
  }, [authorId, deferredQuery, from, initialClientId, initialOrderId, page, status, to, type]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (!canUpload) return; void fetch("/api/document-options", { cache: "no-store" }).then(async (response) => response.ok && setOptions(await response.json())); }, [canUpload]);
  useEffect(() => { if (workflow !== "signed" || !form.orderId) return; void fetch(`/api/documents?orderId=${form.orderId}&type=${DocumentType.CONTRACT}`, { cache: "no-store" }).then(async (response) => setSignedContracts(response.ok ? await response.json() : [])); }, [form.orderId, workflow]);
  useEffect(() => {
    if (!["contract", "signed", "upload", "payment"].includes(workflow)) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ q: deferredOrderQuery.trim(), limit: "30" });
      void fetch(`/api/orders/search?${params}`, { cache: "no-store", signal: controller.signal })
        .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("Не удалось найти заказы")))
        .then((body: { items?: Entity[] }) => setOrderResults(body.items ?? []))
        .catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(reason instanceof Error ? reason.message : "Не удалось найти заказы"); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [deferredOrderQuery, workflow]);

  const availableOrders = [...orderResults, ...options.orders].filter((item, index, rows) => rows.findIndex((candidate) => candidate.id === item.id) === index);
  const filteredOrders = orderResults;
  const selectedOrder = availableOrders.find((item) => item.id === Number(form.orderId));
  const orderPayments = options.payments.filter((item) => item.orderId === Number(form.orderId));
  const selectedPayment = options.payments.find((item) => item.id === Number(paymentId));
  const paymentReady = Boolean(paymentId) || (Number(paymentAmount) > 0 && Boolean(paymentDate) && Boolean(paymentMethod.trim()));

  function resetUpload(type: DocumentType, nextWorkflow: Workflow = "upload") {
    const orderId = initialOrderId ? String(initialOrderId) : "", order = availableOrders.find((item) => item.id === initialOrderId);
    setForm({ ...emptyForm, type, title: type === DocumentType.PAYMENT_RECEIPT ? "Подтверждение оплаты" : documentTypeLabels[type], orderId, clientId: initialClientId ? String(initialClientId) : order?.client?.id ? String(order.client.id) : "" });
    setFile(null); setPaymentId(""); setPaymentAmount(""); setPaymentDate(today()); setPaymentMethod(""); setWorkflow(nextWorkflow); setError("");
  }

  function chooseOrder(orderId: string) {
    const order = availableOrders.find((item) => item.id === Number(orderId));
    setForm((current) => ({ ...current, orderId, clientId: order?.client?.id ? String(order.client.id) : current.clientId }));
    setPaymentId("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!file) return setError("Выберите файл");
    setSaving(true); setError("");
    try {
      const data = new FormData(); Object.entries(form).forEach(([key, value]) => value && data.set(key, value)); data.set("file", file);
      if (form.type === DocumentType.PAYMENT_RECEIPT) { if (paymentId) data.set("paymentId", paymentId); if (paymentAmount) data.set("paymentAmount", paymentAmount); data.set("paymentDate", paymentDate); data.set("paymentMethod", paymentMethod); }
      const response = await fetch("/api/documents", { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() }, body: data }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Не удалось добавить документ");
      setWorkflow(""); setFile(null); setNotice(form.type === DocumentType.PAYMENT_RECEIPT ? "Подтверждение оплаты добавлено" : "Документ добавлен"); setForm({ ...emptyForm, orderId: initialOrderId ? String(initialOrderId) : "", clientId: initialClientId ? String(initialClientId) : "" }); await load();
    } catch (next) { setError(next instanceof Error ? next.message : "Не удалось добавить документ"); }
    finally { setSaving(false); }
  }

  return <section className={embedded ? "min-w-0" : "min-w-0 flex-1 overflow-auto p-4 md:p-8"}>
    <header className={`mb-6 flex flex-wrap items-center gap-4 ${embedded ? "justify-end" : "justify-between"}`}>{!embedded && <div><h1 className="text-3xl font-bold text-white">Документы</h1><p className="mt-1 text-slate-400">Единый архив документов клиентов и заказов</p></div>}{canUpload && <button onClick={() => setWorkflow("chooser")} className="flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white"><Plus size={18}/>Добавить документ</button>}</header>
    {error && <p className="mb-4 rounded-xl border border-red-800 bg-red-950/40 p-3 text-red-300">{error}</p>}
    {notice && <p className="mb-4 rounded-xl border border-emerald-700 bg-emerald-950/40 p-3 text-emerald-200">{notice}</p>}
    {generated && <div className="mb-5 rounded-2xl border border-emerald-600 bg-emerald-950/30 p-4"><strong className="text-white">Договор №{generated.number}</strong><p className="mt-1 text-sm text-emerald-200">Сформирован · v{generated.currentVersion}</p><div className="mt-3 flex flex-wrap gap-2"><Link href={`/documents/${generated.id}`} className="inline-flex min-h-11 items-center rounded-xl bg-emerald-700 px-4 font-semibold text-white">Открыть</Link>{generated.versions?.find((item) => item.version === generated.currentVersion) && <a href={`/api/document-versions/${generated.versions.find((item) => item.version === generated.currentVersion)!.id}?download=1`} className="inline-flex min-h-11 items-center rounded-xl bg-slate-700 px-4 font-semibold text-white">Скачать DOCX</a>}</div></div>}
    {!initialOrderId && !initialClientId && <div className="mb-5 flex max-w-full gap-2 overflow-x-auto pb-1">{documentTabs.map((tab) => <button key={tab.label} onClick={() => { setPage(1); setType(tab.type); }} className={`shrink-0 rounded-full px-4 py-2 text-sm ${type === tab.type ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}>{tab.label}</button>)}</div>}
    <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <input aria-label="Поиск" type="search" value={query} onChange={(event) => { setPage(1); setQuery(event.target.value); }} placeholder="Клиент, телефон, заказ, документ" className={`${control} sm:col-span-2 xl:col-span-2`}/>
      <select aria-label="Тип" value={type} onChange={(event) => { setPage(1); setType(event.target.value as "" | DocumentType); }} className={control}><option value="">Все типы</option>{Object.values(DocumentType).map((value) => <option key={value} value={value}>{documentTypeLabels[value]}</option>)}</select>
      <select aria-label="Статус" value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as "" | DocumentStatus); }} className={control}><option value="">Все статусы</option>{Object.values(DocumentStatus).map((value) => <option key={value} value={value}>{documentStatusLabels[value]}</option>)}</select>
      <input aria-label="Период с" type="date" value={from} onChange={(event) => { setPage(1); setFrom(event.target.value); }} className={control}/><input aria-label="Период по" type="date" value={to} onChange={(event) => { setPage(1); setTo(event.target.value); }} className={control}/>
      {!!options.authors.length && <select aria-label="Ответственный" value={authorId} onChange={(event) => { setPage(1); setAuthorId(event.target.value); }} className={control}><option value="">Все ответственные</option>{options.authors.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
    </div>
    <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]">{loading ? <p className="p-8 text-slate-400">Загрузка…</p> : !items.length ? <p className="p-8 text-center text-slate-400">Документы не найдены</p> : <><div className="space-y-3 p-3 md:hidden">{items.map((item) => <MobileCard key={item.id} item={item}/>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[900px] text-left"><thead className="bg-slate-900 text-sm text-slate-400"><tr>{["Тип", "Документ", "Клиент", "Заказ", "Дата", "Ответственный", "Статус", ""].map((value) => <th key={value} className="p-4">{value}</th>)}</tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-t border-slate-800 text-sm text-slate-300"><td className="p-4">{documentTypeLabels[item.type]}</td><td className="p-4"><p className="font-semibold text-white">{item.title}</p><p className="text-xs text-slate-500">{item.number || "Без номера"}</p></td><td className="p-4">{item.client?.name ?? "—"}</td><td className="p-4">{item.order?.number ?? "—"}</td><td className="p-4">{formatDate(item.documentDate)}</td><td className="p-4">{item.author?.name ?? "—"}</td><td className="p-4"><Status value={item.status}/></td><td className="p-4"><Open item={item}/></td></tr>)}</tbody></table></div></>}</div>
    {workflow === "chooser" && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 sm:items-center sm:p-4"><div role="dialog" aria-modal="true" className="max-h-dvh w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:rounded-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-white">Что вы хотите сделать?</h2><p className="mt-1 text-sm text-slate-400">Выберите рабочий сценарий, а не тип файла.</p></div><button type="button" aria-label="Закрыть" onClick={() => setWorkflow("")} className="grid size-11 place-items-center text-slate-300"><X/></button></div><div className="mt-5 grid gap-3 sm:grid-cols-2">
      <Action icon={<FileCheck2/>} title="Сформировать договор" text="Автозаполнение из заказа и утверждённый DOCX-шаблон" onClick={() => initialOrderId ? (setWorkflow(""), setContractOrderId(initialOrderId)) : setWorkflow("contract")}/>
      <Action icon={<Upload/>} title="Загрузить подписанный договор" text="Подписанная копия существующего договора" onClick={() => { setForm((current) => ({ ...current, type: DocumentType.CONTRACT })); setWorkflow("signed"); }}/>
      <Action icon={<Receipt/>} title="Квитанция / подтверждение оплаты" text="Файл подтверждения с безопасной привязкой к Payment" onClick={() => resetUpload(DocumentType.PAYMENT_RECEIPT, "payment")}/>
      <Action icon={<FolderUp/>} title="Добавить акт" text="Загрузить акт по заказу" onClick={() => resetUpload(DocumentType.ACT)}/>
      <Action icon={<FolderUp/>} title="Добавить проект" text="Загрузить проект по заказу" onClick={() => resetUpload(DocumentType.PROJECT)}/>
      <Action icon={<FolderUp/>} title="Добавить смету" text="Загрузить смету по заказу" onClick={() => resetUpload(DocumentType.ESTIMATE)}/>
      <Action icon={<FolderUp/>} title="Другой документ" text="Только если для документа нет отдельного workflow" onClick={() => resetUpload(DocumentType.OTHER)}/>
    </div><p className="mt-4 text-xs text-slate-500">КП и замерные листы появляются автоматически из существующих КП и замеров.</p></div></div>}
    {(workflow === "contract" || workflow === "signed") && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 sm:items-center sm:p-4"><div role="dialog" aria-modal="true" className="max-h-dvh w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:rounded-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-white">{workflow === "contract" ? "Выберите заказ" : "Выберите договор"}</h2><p className="mt-1 text-sm text-slate-400">Поиск по номеру заказа, клиенту или телефону.</p></div><button type="button" aria-label="Закрыть" onClick={() => setWorkflow("")} className="grid size-11 place-items-center text-slate-300"><X/></button></div><input autoFocus type="search" value={orderQuery} onChange={(event) => setOrderQuery(event.target.value)} placeholder="Заказ, клиент или телефон" className={`${control} mt-5`}/><div className="mt-4 max-h-72 space-y-2 overflow-y-auto">{filteredOrders.map((order) => <button key={order.id} type="button" onClick={() => workflow === "contract" ? (setWorkflow(""), setContractOrderId(order.id)) : chooseOrder(String(order.id))} className={`w-full rounded-xl border p-4 text-left ${Number(form.orderId) === order.id ? "border-blue-500 bg-blue-950/40" : "border-slate-700 bg-slate-950/60"}`}><strong className="text-white">Заказ №{order.number}</strong><p className="mt-1 text-sm text-slate-300">{order.client?.name} · {order.client?.phone || "телефон не указан"}</p></button>)}</div>{workflow === "signed" && form.orderId && <div className="mt-5 border-t border-slate-700 pt-4"><h3 className="font-semibold text-white">Договоры заказа</h3>{signedContracts.length ? <div className="mt-3 space-y-2">{signedContracts.map((item) => <Link key={item.id} href={`/documents/${item.id}`} className="flex min-h-12 items-center justify-between rounded-xl bg-emerald-700 px-4 font-semibold text-white"><span>{item.number} · {item.status === DocumentStatus.SIGNED ? "Подписан" : "Сформирован"}</span><span>Открыть</span></Link>)}</div> : <p className="mt-3 rounded-xl bg-slate-950/60 p-4 text-sm text-slate-300">Договор ещё не сформирован. Сначала используйте действие «Сформировать договор».</p>}</div>}</div></div>}
    {(workflow === "upload" || workflow === "payment") && <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/75 sm:items-center sm:p-4"><form onSubmit={submit} className="max-h-dvh w-full max-w-xl space-y-4 overflow-y-auto rounded-t-2xl border border-slate-700 bg-[#101827] p-5 sm:rounded-2xl"><div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-white">{documentTypeLabels[form.type]}</h2><p className="mt-1 text-sm text-slate-400">{workflow === "payment" ? "Файл не создаёт финансовую операцию автоматически." : "Загрузка документа по заказу."}</p></div><button type="button" aria-label="Закрыть" onClick={() => setWorkflow("")} className="grid size-11 place-items-center text-slate-300"><X/></button></div><div className="grid gap-4 sm:grid-cols-2">
      <Field label="Тип"><div className={`${control} flex items-center`}>{documentTypeLabels[form.type]}</div></Field>
      <Field label="Дата"><input required type="date" value={form.documentDate} onChange={(e) => setForm({ ...form, documentDate: e.target.value })} className={control}/></Field>
      <Field label="Клиент (необязательно)"><select disabled={Boolean(initialClientId)} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={control}><option value="">Не выбран</option>{options.clients.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
      <Field label={workflow === "payment" ? "Заказ *" : "Заказ (необязательно)"}><input type="search" disabled={Boolean(initialOrderId)} value={orderQuery} onChange={(event) => setOrderQuery(event.target.value)} placeholder="Номер, клиент или телефон" className={`${control} mb-2`}/><select required={workflow === "payment"} disabled={Boolean(initialOrderId)} value={form.orderId} onChange={(e) => chooseOrder(e.target.value)} className={control}><option value="">Не выбран</option>{availableOrders.map((item) => <option key={item.id} value={item.id}>{item.number} — {item.client?.name}</option>)}</select></Field>
      {workflow === "payment" && <>
        <Field label="Клиент"><div className={`${control} flex items-center`}>{selectedOrder?.client?.name || "Выберите заказ"}</div></Field>
        <Field label="Связать с существующей оплатой"><select value={paymentId} onChange={(event) => { const value = event.target.value, payment = options.payments.find((item) => item.id === Number(value)); setPaymentId(value); if (payment) { setPaymentAmount(String(payment.amount)); setPaymentDate(payment.operationDate.slice(0, 10)); setPaymentMethod(payment.method); } }} className={control}><option value="">Без Payment — только файл подтверждения</option>{orderPayments.map((item) => <option key={item.id} value={item.id}>{formatMoney(item.amount)} · {formatDate(item.operationDate)} · {item.method}</option>)}</select></Field>
        <Field label="Сумма оплаты, ₸"><input required disabled={Boolean(selectedPayment)} type="number" min={1} step="0.01" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} className={control}/></Field>
        <Field label="Дата оплаты"><input required disabled={Boolean(selectedPayment)} type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} className={control}/></Field>
        <Field label="Способ оплаты"><input required disabled={Boolean(selectedPayment)} maxLength={80} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)} placeholder="Наличные / перевод / терминал" className={control}/></Field>
      </>}
      <Field label="Название"><input required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={control}/></Field>
      <Field label="Номер (пусто = автоматически)"><input maxLength={80} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={control}/></Field>
      <Field label="Файл"><input required type="file" accept={workflow === "payment" ? ".pdf,.png,.jpg,.jpeg,.webp" : ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp"} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block min-h-11 w-full text-sm text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-white"/></Field>
      <Field label="Комментарий"><input maxLength={2000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} className={control}/></Field>
    </div><p className="text-xs text-slate-500">{workflow === "payment" ? "PDF, JPG, PNG или WebP до 15 МБ. Без выбранного Payment сохраняется только подтверждение — новая финансовая операция не создаётся." : "PDF, Word, Excel, PNG, JPEG или WebP до 15 МБ. Файл хранится в закрытом хранилище."}</p><button disabled={saving || !file || (!form.clientId && !form.orderId) || (workflow === "payment" && !paymentReady)} className="min-h-12 w-full rounded-xl bg-blue-600 font-semibold text-white disabled:opacity-50">{saving ? "Сохранение…" : "Сохранить"}</button></form></div>}
    {(page > 1 || hasMore) && <nav aria-label="Страницы документов" className="mt-4 flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="min-h-11 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-40">Назад</button><span className="text-sm text-slate-400">Страница {page}</span><button type="button" disabled={!hasMore || loading} onClick={() => setPage((value) => value + 1)} className="min-h-11 rounded-xl bg-slate-800 px-4 text-white disabled:opacity-40">Далее</button></nav>}
    {contractOrderId && <ContractComposer
      key={contractOrderId}
      orderId={contractOrderId}
      autoOpen
      showTrigger={false}
      onClosed={() => setContractOrderId(null)}
      onGenerated={(document) => { setContractOrderId(null); setGenerated(document ?? null); setNotice(document ? `Договор №${document.number} сформирован` : "Договор сформирован"); void load(); }}
    />}
  </section>;
}

function Action({ icon, title, text, onClick }: { icon: React.ReactNode; title: string; text: string; onClick: () => void }) { return <button type="button" onClick={onClick} className="flex min-h-24 items-start gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4 text-left hover:border-blue-500"><span className="mt-0.5 text-blue-400">{icon}</span><span><strong className="block text-white">{title}</strong><span className="mt-1 block text-sm text-slate-400">{text}</span></span></button>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block min-w-0 text-sm text-slate-300"><span className="mb-1 block">{label}</span>{children}</label>; }
function formatDate(value: string) { return new Intl.DateTimeFormat("ru-RU").format(new Date(value)); }
function formatMoney(value: string | number) { return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(Number(value)); }
function Status({ value }: { value: DocumentStatus }) { return <span className="inline-flex rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-200">{documentStatusLabels[value]}</span>; }
function Open({ item }: { item: DocumentItem }) { const linked = item.recordKind !== "DOCUMENT"; return <Link href={item.openHref} target={linked ? "_blank" : undefined} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-3 font-medium text-white">Открыть{linked && <ExternalLink size={15}/>}</Link>; }
function MobileCard({ item }: { item: DocumentItem }) { return <article className="min-w-0 rounded-xl border border-slate-800 bg-slate-950/60 p-4"><div className="flex min-w-0 items-start gap-3"><FileText className="mt-0.5 shrink-0 text-blue-400"/><div className="min-w-0"><p className="break-words font-semibold text-white">{documentTypeLabels[item.type]}{item.number ? ` №${item.number}` : ""}</p><p className="mt-2 break-words text-sm text-slate-300">{item.client?.name ?? "Клиент не указан"}</p><p className="text-sm text-slate-400">{item.order ? `Заказ №${item.order.number}` : "Без заказа"}</p><p className="text-sm text-slate-400">{formatDate(item.documentDate)}</p><div className="mt-2"><Status value={item.status}/></div></div></div><div className="mt-4"><Open item={item}/></div></article>; }
