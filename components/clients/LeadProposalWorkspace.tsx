"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StairCalculator from "@/components/calculator/StairCalculator";
import PriceObjectionPanel from "@/components/clients/PriceObjectionPanel";
import { MATERIAL_PRESENTATION } from "@/lib/proposals/presentation";

type Calculation = {
  id: number;
  material: string;
  baseClientPrice: string;
  clientPrice: string;
  createdAt: string;
};
type Variant = {
  calculationId?: number;
  material: string;
  total: string | number;
  finalPrice?: string | number;
  calculatedPrice?: string | number;
  pricingMode?: "CALCULATOR" | "MANUAL";
  warranty?: string;
};
type Proposal = {
  id: number;
  number: string;
  version: number;
  status: string;
  sentAt?: string | null;
  createdAt: string;
  validUntil: string;
  snapshot: {
    client?: { name?: string; phone?: string; city?: string; address?: string };
    variants?: Variant[];
  };
  conversion?: { orderId: number } | null;
};
const money = (value: string | number) =>
  `${Number(value).toLocaleString("ru-RU")} ₸`;

export default function LeadProposalWorkspace({
  clientId,
}: {
  clientId: number;
  initialCalculationId?: number;
}) {
  const router = useRouter();
  const [calculations, setCalculations] = useState<Calculation[]>([]),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [optionIds, setOptionIds] = useState<number[]>([]),
    [message, setMessage] = useState(""),
    [saving, setSaving] = useState(false),
    [conversionOpen, setConversionOpen] = useState(false),
    [partners, setPartners] = useState<Array<{ id: number; name: string }>>([]),
    [defaultWorkshopId, setDefaultWorkshopId] = useState<number | null>(null),
    [conversion, setConversion] = useState({
      calculationId: "",
      finalSaleAmount: "",
      adjustmentReason: "",
      address: "",
      promisedAt: "",
      paymentMethod: "kaspi",
      initialPayment: "",
      workshopPartnerId: "",
      workshopCost: "",
      workshopDueAt: "",
      workshopPaymentDueAt: "",
      workshopComment: "",
      managerBonus: "",
      comment: "",
    }),
    [currentTime, setCurrentTime] = useState(0);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/clients/${clientId}/calculations`, { cache: "no-store" }),
      fetch(`/api/clients/${clientId}/proposals`, { cache: "no-store" }),
    ]);
    if (a.ok) setCalculations(await a.json());
    if (b.ok) {
      setProposals(await b.json());
      setCurrentTime(Date.now());
    }
  }, [clientId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const latest = proposals[0];
  const latestExpired = latest
    ? new Date(latest.validUntil).getTime() < currentTime
    : false;
  const latestThree = useMemo(() => {
    const found = new Map<string, Calculation>();
    for (const row of calculations)
      if (!found.has(row.material)) found.set(row.material, row);
    return ["Сосна", "Карагач", "Дуб ламель"]
      .map((name) => found.get(name))
      .filter((row): row is Calculation => Boolean(row));
  }, [calculations]);
  const ids =
    optionIds.length === 3 ? optionIds : latestThree.map((row) => row.id);
  async function createProposal(previousProposalId?: number) {
    setSaving(true);
    setMessage("");
    const response = await fetch(`/api/clients/${clientId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({
        calculationIds: ids,
        previousProposalId,
        validDays: 3,
      }),
    });
    const body = await response.json();
    setMessage(
      response.ok
        ? "КП сформировано"
        : (body.error ?? "Не удалось сформировать КП"),
    );
    if (response.ok) await load();
    setSaving(false);
  }
  async function status(id: number, value: string) {
    const response = await fetch(`/api/proposals/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: value }),
    });
    if (!response.ok) {
      setMessage((await response.json()).error);
      return false;
    }
    await load();
    return true;
  }
  async function send(id: number) {
    setSaving(true);
    const response = await fetch(`/api/proposals/${id}/send`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    const body = await response.json();
    setMessage(
      response.ok
        ? "PDF отправлен через WhatsApp"
        : (body.error ?? "Не удалось отправить PDF"),
    );
    if (response.ok) await load();
    setSaving(false);
  }
  async function followUp(days: number) {
    const at = new Date(Date.now() + days * 86400000);
    at.setHours(10, 0, 0, 0);
    const response = await fetch(`/api/clients/${clientId}/next-actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nextActionType: "FOLLOW_UP",
        nextActionAt: at.toISOString(),
        nextActionComment: "Повторный контакт после КП",
      }),
    });
    setMessage(
      response.ok
        ? `Контакт назначен на ${at.toLocaleDateString("ru-RU")}`
        : (await response.json()).error,
    );
  }
  async function openConversion() {
    if (!latest?.snapshot.variants?.length) return;
    const first = latest.snapshot.variants[0];
    const response = await fetch("/api/orders/options", { cache: "no-store" });
    if (response.ok) {
      const options = await response.json() as {
        partners?: Array<{ id: number; name: string }>;
        defaultWorkshopPartnerId?: number | null;
      };
      setPartners(options.partners ?? []);
      setDefaultWorkshopId(options.defaultWorkshopPartnerId ?? null);
    }
    setConversion((current) => ({
      ...current,
      calculationId: String(first.calculationId ?? latestThree.find((item) => item.material === first.material)?.id ?? ""),
      finalSaleAmount: String(first.finalPrice ?? first.total),
      address: latest.snapshot.client?.address ?? "",
    }));
    setConversionOpen(true);
  }
  async function convert(id: number) {
    setSaving(true);
    setMessage("");
    if (!(await status(id, "ACCEPTED"))) {
      setSaving(false);
      return;
    }
    const stageResponse = await fetch(`/api/clients/${clientId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "WON" }),
    });
    if (!stageResponse.ok) {
      const stageBody = await stageResponse.json() as { error?: string };
      setMessage(stageBody.error ?? "Не удалось перевести заявку в заказ");
      setSaving(false);
      return;
    }
    const response = await fetch(`/api/proposals/${id}/convert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        ...conversion,
        calculationId: Number(conversion.calculationId),
        finalSaleAmount: Number(conversion.finalSaleAmount),
        initialPayment: Number(conversion.initialPayment || 0),
        workshopPartnerId: conversion.workshopPartnerId
          ? Number(conversion.workshopPartnerId)
          : null,
        workshopCost: conversion.workshopCost
          ? Number(conversion.workshopCost)
          : undefined,
        managerBonus: Number(conversion.managerBonus || 0),
      }),
    });
    const body = await response.json();
    if (response.ok) router.push(`/orders/${body.id}`);
    else {
      setMessage(body.error);
      setSaving(false);
    }
  }
  return (
    <main className="space-y-6 p-4 md:p-8">
      <header>
        <Link href={`/clients/${clientId}`} className="text-blue-300">
          ← К заявке
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-white md:text-3xl">
          Расчёт и КП
        </h1>
        <p className="mt-1 text-slate-400">
          Один ввод — три готовых варианта для клиента
        </p>
      </header>
      {message && (
        <p
          role="status"
          className="rounded-xl border border-slate-700 p-4 text-slate-200"
        >
          {message}
        </p>
      )}
      <section className="rounded-2xl border border-slate-700 bg-[#101827] p-4 md:p-7">
        <StairCalculator
          clientId={clientId}
          onLeadOptionsSaved={(options) => {
            setOptionIds(options.map((item) => item.id));
            void load();
          }}
        />
      </section>
      <section className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
        <h2 className="text-xl font-semibold text-white">
          Коммерческое предложение
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Сосна, карагач и дуб ламель попадут в одно КП.
        </p>
        <button
          disabled={saving || ids.length !== 3}
          onClick={() => void createProposal()}
          className="mt-4 min-h-12 w-full rounded-xl bg-blue-600 px-5 font-semibold text-white disabled:opacity-50 sm:w-auto"
        >
          Сформировать КП
        </button>
      </section>
      {latest && (
        <section className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">
                КП №{latest.number}
              </h2>
              <p className="text-sm text-slate-400">
                Версия {latest.version} ·{" "}
                {new Date(latest.createdAt).toLocaleDateString("ru-RU")} ·{" "}
                {latest.status}
              </p>
              <p
                className={`mt-1 text-sm ${latestExpired ? "font-semibold text-rose-300" : "text-emerald-300"}`}
              >
                {latestExpired ? "Срок действия истёк" : "Действительно до"}: {" "}
                {new Date(latest.validUntil).toLocaleDateString("ru-RU")}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {latest.snapshot.variants?.map((variant) => (
              <article key={variant.material} className="rounded-xl border border-amber-800/40 bg-slate-900 p-4">
                <h3 className="mt-1 text-sm font-semibold uppercase tracking-wide text-white">
                  {variant.material}
                </h3>
                <p className="mt-2 min-h-10 text-xs leading-5 text-slate-400">
                  {MATERIAL_PRESENTATION[variant.material]?.description}
                </p>
                <p className="mt-3 text-xl font-bold text-amber-200">
                  {money(variant.total)}
                </p>
                <div className="mt-3 rounded-lg bg-amber-100 px-3 py-2 text-slate-950">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">
                    Гарантия
                  </p>
                  <p className="text-sm font-bold uppercase">
                    {variant.warranty ?? "По материалу"}
                  </p>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-5 grid gap-3 sm:flex sm:flex-wrap">
            <a
              target="_blank"
              rel="noreferrer"
              href={`/api/proposals/${latest.id}/pdf`}
              className="flex min-h-12 items-center justify-center rounded-xl bg-slate-800 px-5 text-white"
            >
              Открыть / скачать PDF
            </a>
            {latest.status !== "SENT" && (
              <button
                disabled={saving}
                onClick={() => void send(latest.id)}
                className="min-h-12 rounded-xl bg-green-700 px-5 font-semibold text-white"
              >
                Отправить PDF в WhatsApp
              </button>
            )}
            <button
              onClick={() => void createProposal(latest.id)}
              className="min-h-12 rounded-xl bg-slate-700 px-5 text-white"
            >
              Новая версия
            </button>
            <button
              onClick={() => void openConversion()}
              className="min-h-12 rounded-xl bg-emerald-600 px-5 font-semibold text-white"
            >
              Оформить заказ
            </button>
          </div>
          {latest.sentAt && (
            <div className="mt-5 rounded-xl border border-blue-800 bg-blue-950/30 p-4">
              <p className="font-medium text-white">
                Когда связаться с клиентом?
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 sm:flex">
                {[
                  [1, "Завтра"],
                  [2, "Через 2 дня"],
                  [3, "Через 3 дня"],
                ].map(([days, label]) => (
                  <button
                    key={days}
                    onClick={() => void followUp(Number(days))}
                    className="min-h-11 rounded-xl bg-slate-800 px-3 text-sm text-white"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}
      <PriceObjectionPanel
        clientId={clientId}
        calculations={calculations}
        proposalId={latest?.id}
        onDone={setMessage}
      />
      {latest && conversionOpen && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 bg-black/70"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !saving) setConversionOpen(false);
          }}
        >
          <form
            aria-label="Оформить заказ из выбранного варианта КП"
            onSubmit={(event) => {
              event.preventDefault();
              void convert(latest.id);
            }}
            className="absolute inset-y-0 right-0 grid w-full max-w-2xl content-start gap-4 overflow-y-auto border-l border-slate-700 bg-[#101827] p-5 shadow-2xl sm:grid-cols-2 sm:p-7"
          >
            <div className="sm:col-span-2">
              <h2 className="text-xl font-bold text-white">Оформить заказ</h2>
              <p className="mt-1 text-sm text-slate-400">
                Выберите согласованный клиентом материал. Система больше не выбирает вариант автоматически.
              </p>
            </div>
            <label className="text-sm text-slate-300 sm:col-span-2">
              Вариант КП
              <select
                required
                value={conversion.calculationId}
                onChange={(event) => {
                  const selected = latest.snapshot.variants?.find((item) =>
                    String(item.calculationId ?? latestThree.find((calculation) => calculation.material === item.material)?.id ?? "") === event.target.value);
                  setConversion((current) => ({
                    ...current,
                    calculationId: event.target.value,
                    finalSaleAmount: String(selected?.finalPrice ?? selected?.total ?? ""),
                  }));
                }}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
              >
                <option value="">Выберите материал</option>
                {latest.snapshot.variants?.map((variant) => (
                  <option key={`${variant.calculationId}-${variant.material}`} value={variant.calculationId ?? latestThree.find((item) => item.material === variant.material)?.id}>
                    {variant.material} · {money(variant.finalPrice ?? variant.total)}
                  </option>
                ))}
              </select>
            </label>
            {[
              ["finalSaleAmount", "Финальная сумма продажи", "number"],
              ["adjustmentReason", "Основание изменения цены КП", "text"],
              ["address", "Адрес заказа", "text"],
              ["promisedAt", "Обещанный срок", "date"],
              ["initialPayment", "Первый платёж (необязательно)", "number"],
              ["managerBonus", "Бонус менеджера (начисление)", "number"],
            ].map(([key, title, type]) => (
              <label key={key} className="text-sm text-slate-300">
                {title}
                <input
                  required={["finalSaleAmount", "address"].includes(key)}
                  type={type}
                  min={type === "number" ? "0" : undefined}
                  value={conversion[key as keyof typeof conversion]}
                  onChange={(event) => setConversion((current) => ({ ...current, [key]: event.target.value }))}
                  className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
                />
              </label>
            ))}
            <label className="text-sm text-slate-300">
              Способ оплаты
              <select value={conversion.paymentMethod} onChange={(event) => setConversion((current) => ({ ...current, paymentMethod: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white">
                <option value="kaspi">Kaspi</option><option value="cash">Наличные</option><option value="bank_transfer">Банковский перевод</option><option value="other">Другое</option>
              </select>
            </label>
            <label className="text-sm text-slate-300">
              Передать в цех сейчас (необязательно)
              <select
                value={conversion.workshopPartnerId}
                onChange={(event) => setConversion((current) => ({ ...current, workshopPartnerId: event.target.value }))}
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white"
              >
                <option value="">Не назначать</option>
                {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}{partner.id === defaultWorkshopId ? " · основной" : ""}</option>)}
              </select>
            </label>
            {conversion.workshopPartnerId && (
              <>
                <label className="text-sm text-slate-300">Согласованная стоимость цеха<input required type="number" min="1" value={conversion.workshopCost} onChange={(event) => setConversion((current) => ({ ...current, workshopCost: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
                <label className="text-sm text-slate-300">Срок готовности цеха<input type="date" value={conversion.workshopDueAt} onChange={(event) => setConversion((current) => ({ ...current, workshopDueAt: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
                <label className="text-sm text-slate-300">Срок выплаты цеху<input type="date" value={conversion.workshopPaymentDueAt} onChange={(event) => setConversion((current) => ({ ...current, workshopPaymentDueAt: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
                <label className="text-sm text-slate-300 sm:col-span-2">Комментарий цеху<input value={conversion.workshopComment} onChange={(event) => setConversion((current) => ({ ...current, workshopComment: event.target.value }))} className="mt-1 min-h-12 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-white" /></label>
              </>
            )}
            <label className="text-sm text-slate-300 sm:col-span-2">
              Комментарий к заказу
              <textarea value={conversion.comment} onChange={(event) => setConversion((current) => ({ ...current, comment: event.target.value }))} className="mt-1 min-h-24 w-full rounded-xl border border-slate-700 bg-slate-900 p-3 text-white" />
            </label>
            <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
              <button type="button" disabled={saving} onClick={() => setConversionOpen(false)} className="min-h-12 rounded-xl border border-slate-700 px-5 font-semibold text-white">Отмена</button>
              <button disabled={saving || !conversion.calculationId} className="min-h-12 rounded-xl bg-emerald-600 px-5 font-semibold text-white disabled:opacity-50">{saving ? "Оформление…" : "Подтвердить и создать заказ"}</button>
            </div>
          </form>
        </div>
      )}
      <section className="rounded-2xl border border-slate-700 bg-[#101827] p-5">
        <h2 className="text-xl font-semibold text-white">
          Коммерческие предложения
        </h2>
        <div className="mt-4 space-y-3">
          {proposals.map((proposal) => (
            <article
              key={proposal.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-900 p-4"
            >
              <div>
                <p className="font-medium text-white">КП №{proposal.number}</p>
                <p className="text-sm text-slate-400">
                  Версия {proposal.version} · {proposal.status} ·{" "}
                  {proposal.snapshot.variants
                    ?.map((item) => money(item.total))
                    .join(" / ")}
                </p>
              </div>
              {proposal.conversion && (
                <Link
                  href={`/orders/${proposal.conversion.orderId}`}
                  className="text-emerald-300"
                >
                  Открыть заказ
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
