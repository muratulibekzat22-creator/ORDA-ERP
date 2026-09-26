"use client";

import { ArrowLeft, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  clearNewOrderDraft,
  EMPTY_NEW_ORDER_FORM,
  readNewOrderDraft,
  resolveOrderSubmission,
  type DraftClient,
  type NewOrderFormValues,
  type OrderDraftSubmission,
  writeNewOrderDraft,
} from "@/lib/orders/new-order-draft";

type Option = { id: number; name: string };
type PaymentMethodOption = { value: string; label: string };
type RegistrationOptions = {
  role: "DIRECTOR" | "MANAGER";
  currentUserId: number;
  managers: Option[];
  materials: string[];
  frameTypes: string[];
  railingTypes: string[];
  paymentMethods: PaymentMethodOption[];
  existingClient: DraftClient | null;
  ownershipConflict: boolean;
};

const control = "mt-1 min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";

export default function NewOrderForm() {
  const router = useRouter();
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [existingClient, setExistingClient] = useState<RegistrationOptions["existingClient"]>(null);
  const [form, setForm] = useState<NewOrderFormValues>(EMPTY_NEW_ORDER_FORM);
  const [draftReady, setDraftReady] = useState(false);
  const [submission, setSubmission] = useState<OrderDraftSubmission | null>(null);
  const submitting = useRef(false);
  const draftCleared = useRef(false);

  useEffect(() => {
    void fetch("/api/orders/options", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as RegistrationOptions & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Не удалось загрузить форму");
        const saved = readNewOrderDraft(window.localStorage, body.currentUserId);
        const defaults = {
          ...EMPTY_NEW_ORDER_FORM,
          managerUserId: String(body.role === "MANAGER" ? body.currentUserId : body.managers[0]?.id ?? ""),
          material: body.materials[0] ?? "",
          frameType: body.frameTypes[0] ?? EMPTY_NEW_ORDER_FORM.frameType,
          railingType: body.railingTypes[0] ?? "",
        };
        const restored = saved ? { ...defaults, ...saved.form } : defaults;
        if (body.role === "MANAGER") restored.managerUserId = String(body.currentUserId);
        setOptions(body);
        setForm(restored);
        setExistingClient(saved?.existingClient ?? null);
        setSubmission(saved?.submission ?? null);
        setDraftReady(true);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Не удалось загрузить форму"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!draftReady || !options || draftCleared.current) return;
    writeNewOrderDraft(window.localStorage, {
      version: 1,
      userId: options.currentUserId,
      form,
      existingClient,
      submission,
      updatedAt: new Date().toISOString(),
    });
  }, [draftReady, existingClient, form, options, submission]);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function lookupClient() {
    if (!form.phone.trim()) return;
    const response = await fetch(`/api/orders/options?phone=${encodeURIComponent(form.phone)}`, { cache: "no-store" });
    const body = (await response.json()) as RegistrationOptions & { error?: string };
    if (!response.ok) return setError(body.error ?? "Не удалось проверить телефон");
    if (body.ownershipConflict) {
      setExistingClient(null);
      return setError("Клиент с этим телефоном закреплён за другим менеджером.");
    }
    setExistingClient(body.existingClient);
    if (body.existingClient)
      setForm((current) => ({
        ...current,
        clientName: body.existingClient?.name ?? current.clientName,
        location: [body.existingClient?.city, body.existingClient?.address].filter(Boolean).join(", ") || current.location,
        managerUserId: options?.role === "DIRECTOR" && body.existingClient?.managerUserId
          ? String(body.existingClient.managerUserId)
          : current.managerUserId,
      }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    setError("");
    if (Number(form.initialPayment) > Number(form.amount))
      return setError("Полученная сумма не может превышать цену заказа");
    submitting.current = true;
    setSaving(true);
    try {
      const payload = {
        ...form,
        clientId: existingClient?.id,
        managerUserId: Number(form.managerUserId),
        amount: Number(form.amount),
        initialPayment: Number(form.initialPayment),
      };
      const payloadText = JSON.stringify(payload);
      const nextSubmission = resolveOrderSubmission(submission, payloadText, () => crypto.randomUUID());
      setSubmission(nextSubmission);
      if (options)
        writeNewOrderDraft(window.localStorage, {
          version: 1,
          userId: options.currentUserId,
          form,
          existingClient,
          submission: nextSubmission,
          updatedAt: new Date().toISOString(),
        });
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": nextSubmission.key },
        body: payloadText,
      });
      const body = (await response.json()) as { id?: number; error?: string };
      if (!response.ok || !body.id) throw new Error(body.error ?? "Не удалось создать заказ");
      if (options) {
        draftCleared.current = true;
        clearNewOrderDraft(window.localStorage, options.currentUserId);
      }
      router.push(`/orders/${body.id}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать заказ");
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  if (loading)
    return <div className="flex min-h-64 items-center justify-center text-slate-300"><Loader2 className="mr-2 animate-spin" /> Загрузка формы…</div>;
  if (!options)
    return <p role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-300">{error || "Форма недоступна"}</p>;

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-4xl space-y-4 p-4 pb-24 sm:p-6 lg:p-8">
      <header>
        <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-blue-300"><ArrowLeft size={16} /> Заказы</Link>
        <h1 className="mt-2 text-3xl font-bold text-white">Новый заказ</h1>
        <p className="mt-1 text-sm text-slate-400">Только данные, нужные для старта работы.</p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Клиент" required><input required value={form.clientName} onChange={(event) => set("clientName", event.target.value)} className={control} /></Field>
          <Field label="Телефон" required><input required inputMode="tel" value={form.phone} onChange={(event) => { set("phone", event.target.value); setExistingClient(null); }} onBlur={() => void lookupClient()} className={control} /></Field>
          <Field label="Город / адрес" required><input required value={form.location} onChange={(event) => set("location", event.target.value)} placeholder="Кызылорда, ул. …" className={control} /></Field>
          <Field label="Ответственный" required><select required disabled={options.role === "MANAGER"} value={form.managerUserId} onChange={(event) => set("managerUserId", event.target.value)} className={control}>{options.managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></Field>
          <Field label="Цена клиенту" required><input required type="number" min="0.01" step="0.01" inputMode="decimal" value={form.amount} onChange={(event) => set("amount", event.target.value)} className={control} /></Field>
          <Field label="Полученная оплата"><input type="number" min="0" step="0.01" inputMode="decimal" value={form.initialPayment} onChange={(event) => set("initialPayment", event.target.value)} className={control} /></Field>
          <Field label="Способ оплаты" required><select required value={form.paymentMethod} onChange={(event) => set("paymentMethod", event.target.value)} className={control}>{options.paymentMethods.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}</select></Field>
          <Field label="Срок"><input type="date" value={form.readinessDate} onChange={(event) => set("readinessDate", event.target.value)} className={control} /></Field>
          <Field label="Комментарий"><textarea rows={3} value={form.comment} onChange={(event) => set("comment", event.target.value)} className={`${control} py-3`} /></Field>
        </div>
        {existingClient && <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-300"><CheckCircle2 size={17} /> Используется существующий клиент. Дубль не создаётся.</p>}
      </section>

      <details className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
        <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-white">Технические параметры <ChevronDown size={18} /></summary>
        <p className="mt-1 text-sm text-slate-400">Необязательно. Можно заполнить позже в карточке заказа.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Каркас"><select value={form.frameType} onChange={(event) => set("frameType", event.target.value)} className={control}>{options.frameTypes.map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Материал"><select value={form.material} onChange={(event) => set("material", event.target.value)} className={control}>{options.materials.map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Ограждение"><select value={form.railingType} onChange={(event) => set("railingType", event.target.value)} className={control}>{options.railingTypes.map((value) => <option key={value}>{value}</option>)}</select></Field>
          <Field label="Цвет"><input value={form.color} onChange={(event) => set("color", event.target.value)} className={control} /></Field>
          <label className="rounded-xl border border-slate-800 p-3 text-sm text-slate-300"><span className="flex items-center gap-2"><input type="checkbox" checked={form.lighting} onChange={(event) => set("lighting", event.target.checked)} /> Подсветка</span>{form.lighting && <input value={form.lightingDetails} onChange={(event) => set("lightingDetails", event.target.value)} placeholder="Комментарий" className={control} />}</label>
          <label className="rounded-xl border border-slate-800 p-3 text-sm text-slate-300"><span className="flex items-center gap-2"><input type="checkbox" checked={form.cladding} onChange={(event) => set("cladding", event.target.checked)} /> Обшивка</span>{form.cladding && <input value={form.claddingDetails} onChange={(event) => set("claddingDetails", event.target.value)} placeholder="Комментарий" className={control} />}</label>
        </div>
      </details>

      {error && <p role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-red-200">{error}</p>}
      <div className="sticky bottom-3 flex rounded-2xl border border-slate-700 bg-[#101827]/95 p-3 shadow-2xl backdrop-blur sm:justify-end"><button disabled={saving} className="min-h-12 w-full rounded-xl bg-blue-600 px-6 font-semibold text-white disabled:opacity-50 sm:w-auto">{saving ? "Сохранение…" : "Создать заказ"}</button></div>
    </form>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="text-sm text-slate-300">{label}{required && <span className="text-red-300"> *</span>}{children}</label>;
}
