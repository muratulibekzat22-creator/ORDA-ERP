"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import StairCalculator from "@/components/calculator/StairCalculator";
import PriceObjectionPanel from "@/components/clients/PriceObjectionPanel";

type Calculation = {
  id: number;
  material: string;
  baseClientPrice: string;
  clientPrice: string;
  createdAt: string;
};
type Variant = { material: string; total: string | number };
type Proposal = {
  id: number;
  number: string;
  version: number;
  status: string;
  sentAt?: string | null;
  createdAt: string;
  snapshot: {
    client?: { name?: string; phone?: string };
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
    [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    const [a, b] = await Promise.all([
      fetch(`/api/clients/${clientId}/calculations`, { cache: "no-store" }),
      fetch(`/api/clients/${clientId}/proposals`, { cache: "no-store" }),
    ]);
    if (a.ok) setCalculations(await a.json());
    if (b.ok) setProposals(await b.json());
  }, [clientId]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const latest = proposals[0];
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
        validDays: 14,
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
    if (!response.ok) return setMessage((await response.json()).error);
    await load();
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
  async function convert(id: number) {
    if (!confirm("Клиент согласился? Будет создан заказ из КП.")) return;
    await status(id, "ACCEPTED");
    await fetch(`/api/clients/${clientId}/stage`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage: "WON" }),
    });
    const response = await fetch(`/api/proposals/${id}/convert`, {
      method: "POST",
    });
    const body = await response.json();
    if (response.ok) router.push(`/orders/${body.id}`);
    else setMessage(body.error);
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
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {latest.snapshot.variants?.map((variant) => (
              <article key={variant.material} className="rounded-xl bg-slate-900 p-4">
                <h3 className="mt-1 font-semibold text-white">
                  {variant.material}
                </h3>
                <p className="mt-3 text-lg font-bold text-blue-300">
                  {money(variant.total)}
                </p>
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
              onClick={() => void convert(latest.id)}
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
