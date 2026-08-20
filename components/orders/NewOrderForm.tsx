"use client";

import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import CityCombobox from "@/components/clients/CityCombobox";

type Option = { id: number; name: string };
type RegistrationOptions = {
  role: "DIRECTOR" | "MANAGER";
  currentUserId: number;
  managers: Option[];
  materials: string[];
  frameTypes: string[];
  railingTypes: string[];
  paymentMethods: Array<{ value: string; label: string }>;
  existingClient: { id: number; name: string; phone: string; city: string; address: string; managerUserId?: number | null } | null;
  ownershipConflict: boolean;
};

const input = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";
const area = `${input} min-h-24 py-3`;
const today = () => new Date().toISOString().slice(0, 10);

function Block({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
    <h2 className="text-lg font-semibold text-white">{title}</h2>
    <p className="mt-1 text-sm text-slate-400">{description}</p>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">{children}</div>
  </section>;
}

function Field({ label, required, children, wide = false }: { label: string; required?: boolean; children: React.ReactNode; wide?: boolean }) {
  return <label className={`text-sm text-slate-300 ${wide ? "sm:col-span-2" : ""}`}>
    {label}{required ? <span className="text-red-300"> *</span> : null}
    {children}
  </label>;
}

export default function NewOrderForm() {
  const router = useRouter();
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [existingClient, setExistingClient] = useState<RegistrationOptions["existingClient"]>(null);
  const [form, setForm] = useState({
    clientName: "", phone: "", city: "", address: "", mapUrl: "", managerUserId: "",
    orderReceivedAt: today(), readinessDate: "", calendarDays: "",
    frameType: "Металлический каркас", frameComment: "", material: "", materialOther: "",
    railingType: "Классика", supportType: "", color: "", lighting: false, lightingDetails: "",
    cladding: false, claddingDetails: "", additionalDetails: "",
    amount: "", initialPayment: "0", paymentDate: "", paymentMethod: "BANK_TRANSFER", paymentComment: "",
  });

  useEffect(() => {
    void fetch("/api/orders/options", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as RegistrationOptions & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить форму");
        setOptions(body);
        setForm((current) => ({ ...current, managerUserId: String(body.role === "MANAGER" ? body.currentUserId : body.managers[0]?.id ?? ""), material: body.materials[0] ?? "" }));
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить форму"))
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }));
  const remaining = useMemo(() => Math.max(0, Number(form.amount || 0) - Number(form.initialPayment || 0)), [form.amount, form.initialPayment]);

  async function lookupClient() {
    if (!form.phone.trim()) return;
    setError("");
    const response = await fetch(`/api/orders/options?phone=${encodeURIComponent(form.phone)}`, { cache: "no-store" });
    const body = await response.json() as RegistrationOptions & { error?: string };
    if (!response.ok) return setError(body.error ?? "Не удалось проверить телефон");
    if (body.ownershipConflict) {
      setExistingClient(null);
      return setError("Клиент с этим телефоном закреплён за другим менеджером. Новый дубль не создан.");
    }
    setExistingClient(body.existingClient);
    if (body.existingClient) setForm((current) => ({
      ...current,
      clientName: body.existingClient?.name ?? current.clientName,
      city: body.existingClient?.city ?? current.city,
      address: body.existingClient?.address || current.address,
      managerUserId: options?.role === "DIRECTOR" && body.existingClient?.managerUserId ? String(body.existingClient.managerUserId) : current.managerUserId,
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (Number(form.initialPayment) > Number(form.amount)) return setError("Полученная сумма не может превышать сумму заказа");
    setSaving(true);
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...form, clientId: existingClient?.id, managerUserId: Number(form.managerUserId), amount: Number(form.amount), initialPayment: Number(form.initialPayment) }),
      });
      const body = await response.json() as { id?: number; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Не удалось создать заказ");
      router.push(`/orders/${body.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать заказ");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center text-slate-300"><Loader2 className="mr-2 animate-spin" /> Загрузка формы…</div>;
  if (!options) return <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-300">{error || "Форма недоступна"}</p>;

  return <form onSubmit={submit} className="mx-auto w-full max-w-5xl space-y-4 p-3 pb-24 sm:p-5 lg:p-8">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-blue-300"><ArrowLeft size={16} /> Заказы</Link>
        <h1 className="mt-2 text-2xl font-bold text-white sm:text-3xl">Новый заказ</h1>
        <p className="mt-1 text-sm text-slate-400">Регистрация уже полученного заказа без создания заявки или КП.</p>
      </div>
    </header>

    <Block title="Клиент" description="Телефон проверяется по существующим клиентам, чтобы не создавать дубль.">
      <Field label="ФИО клиента" required><input className={input} required value={form.clientName} onChange={(e) => set("clientName", e.target.value)} /></Field>
      <Field label="Телефон / WhatsApp" required><input className={input} required inputMode="tel" value={form.phone} onChange={(e) => { set("phone", e.target.value); setExistingClient(null); }} onBlur={() => void lookupClient()} /></Field>
      <Field label="Город" required><CityCombobox value={form.city} onChange={(value) => set("city", value)} className={input}/></Field>
      <Field label="Адрес объекта"><input className={input} value={form.address} onChange={(e) => set("address", e.target.value)} /></Field>
      <Field label="Ссылка на карту" wide><input className={input} type="url" placeholder="https://…" value={form.mapUrl} onChange={(e) => set("mapUrl", e.target.value)} /></Field>
      {existingClient ? <p className="sm:col-span-2 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 size={17} /> Будет привязан существующий клиент #{existingClient.id}. Новый клиент не создаётся.</p> : null}
    </Block>

    <Block title="Заказ" description="Дата получения хранится отдельно от системного времени регистрации в ORDA.">
      <Field label="Дата получения заказа" required><input className={input} required type="date" value={form.orderReceivedAt} onChange={(e) => set("orderReceivedAt", e.target.value)} /></Field>
      <Field label="Ответственный менеджер" required><select className={input} required disabled={options.role === "MANAGER"} value={form.managerUserId} onChange={(e) => set("managerUserId", e.target.value)}>{options.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></Field>
      <Field label="Дата готовности"><input className={input} type="date" value={form.readinessDate} onChange={(e) => set("readinessDate", e.target.value)} /></Field>
      <Field label="Или календарных дней"><input className={input} type="number" min="0" max="3650" value={form.calendarDays} onChange={(e) => set("calendarDays", e.target.value)} /></Field>
    </Block>

    <Block title="Технические параметры" description="Параметры существующего заказа без изменения lifecycle.">
      <Field label="Тип основания / каркаса"><select className={input} value={form.frameType} onChange={(e) => set("frameType", e.target.value)}>{options.frameTypes.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Комментарий к каркасу"><input className={input} value={form.frameComment} onChange={(e) => set("frameComment", e.target.value)} /></Field>
      <Field label="Материал лестницы" required><select className={input} required value={form.material} onChange={(e) => set("material", e.target.value)}>{options.materials.map((value) => <option key={value}>{value}</option>)}</select></Field>
      {form.material === "Другое" ? <Field label="Другой материал" required><input className={input} required value={form.materialOther} onChange={(e) => set("materialOther", e.target.value)} /></Field> : <div />}
      <Field label="Балясина / ограждение"><select className={input} value={form.railingType} onChange={(e) => set("railingType", e.target.value)}>{options.railingTypes.map((value) => <option key={value}>{value}</option>)}</select></Field>
      <Field label="Стойка / опора"><input className={input} value={form.supportType} onChange={(e) => set("supportType", e.target.value)} /></Field>
      <Field label="Цвет"><input className={input} placeholder="Название, код или комментарий" value={form.color} onChange={(e) => set("color", e.target.value)} /></Field>
      <div className="grid gap-3 rounded-xl border border-slate-800 p-3">
        <label className="flex items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={form.lighting} onChange={(e) => set("lighting", e.target.checked)} /> Подсветка</label>
        {form.lighting ? <input className={input} placeholder="Тип / комментарий" value={form.lightingDetails} onChange={(e) => set("lightingDetails", e.target.value)} /> : null}
      </div>
      <div className="grid gap-3 rounded-xl border border-slate-800 p-3">
        <label className="flex items-center gap-3 text-sm text-slate-200"><input type="checkbox" checked={form.cladding} onChange={(e) => set("cladding", e.target.checked)} /> Обшивка</label>
        {form.cladding ? <input className={input} placeholder="Тип / материал / комментарий" value={form.claddingDetails} onChange={(e) => set("claddingDetails", e.target.value)} /> : null}
      </div>
    </Block>

    <Block title="Дополнительно" description="Особенности объекта, монтажа и нестандартные параметры заказа.">
      <Field label="Дополнительные параметры" wide><textarea className={area} value={form.additionalDetails} onChange={(e) => set("additionalDetails", e.target.value)} /></Field>
    </Block>

    <Block title="Финансы заказа" description="Остаток и initial Payment рассчитываются и создаются backend-ом.">
      <Field label="Общая сумма" required><input className={input} required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></Field>
      <Field label="Получено ранее"><input className={input} type="number" min="0" step="0.01" inputMode="decimal" value={form.initialPayment} onChange={(e) => set("initialPayment", e.target.value)} /></Field>
      <Field label="Остаток"><output className={`${input} flex items-center bg-slate-900 text-amber-300`}>{remaining.toLocaleString("ru-RU")} ₸</output></Field>
      <Field label="Способ оплаты" required><select className={input} required value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>{options.paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></Field>
      <Field label="Дата оплаты"><input className={input} type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} /></Field>
      <Field label="Комментарий к оплате"><input className={input} value={form.paymentComment} onChange={(e) => set("paymentComment", e.target.value)} /></Field>
    </Block>

    {error ? <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-300">{error}</p> : null}
    <div className="sticky bottom-3 rounded-2xl border border-slate-700 bg-[#101827]/95 p-3 shadow-2xl backdrop-blur sm:flex sm:justify-end">
      <button type="submit" disabled={saving} className="min-h-12 w-full rounded-xl bg-blue-600 px-6 font-semibold text-white hover:bg-blue-500 disabled:opacity-50 sm:w-auto">{saving ? "Сохранение…" : "Создать заказ"}</button>
    </div>
  </form>;
}
