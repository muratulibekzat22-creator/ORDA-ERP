"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

interface Props {
  orderId: number;
}

type PaymentPart = {
  id: number;
  method: string;
  amount: string | number;
  reference: string | null;
};

type Receipt = {
  id: number;
  displayNumber: string;
  status: string;
  verificationToken: string;
  publicAccessEnabled: boolean;
  documentId: number;
  document: {
    currentVersion: number;
    versions: Array<{ id: number; version: number; fileName: string }>;
  };
};

type PaymentRecord = {
  id: number;
  amount: string | number;
  type: string;
  method: string;
  comment: string | null;
  operationDate: string;
  author: string | null;
  registeredBy: { id: number; name: string } | null;
  partnerId: number | null;
  parts: PaymentPart[];
  receipt: Receipt | null;
  refunds: Array<{ id: number; amount: string | number; operationDate: string }>;
  documents: Array<{
    id: number;
    type: string;
    number: string;
    status: string;
    currentVersion: number;
    versions: Array<{ id: number; version: number; fileName: string }>;
  }>;
};

type PartDraft = { method: string; amount: string; reference: string };

const methods = [
  "Наличные",
  "Kaspi перевод",
  "Kaspi рассрочка",
  "Банковская карта",
  "Банковский перевод",
  "Другое",
];

const clientPaymentTypes = new Set([
  "CLIENT_PAYMENT",
  "payment",
  "PREPAYMENT",
  "ADDITIONAL_PAYMENT",
  "REFUND",
]);

const control =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";

function money(value: string | number) {
  return `${Number(value).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} ₸`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Almaty",
  }).format(new Date(value));
}

export default function ProjectPayments({ orderId }: Props) {
  const router = useRouter();
  const { data: session } = useSession();
  const { getKey, reset } = useIdempotencyKey();
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [mixed, setMixed] = useState(false);
  const [form, setForm] = useState({
    amount: "",
    type: "Предоплата",
    method: "Kaspi перевод",
    comment: "",
  });
  const [parts, setParts] = useState<PartDraft[]>([
    { method: "Наличные", amount: "", reference: "" },
    { method: "Kaspi перевод", amount: "", reference: "" },
  ]);
  const [refund, setRefund] = useState<{
    payment: PaymentRecord;
    reason: string;
    parts: PartDraft[];
    key: string;
  } | null>(null);
  const canRefund = ["DIRECTOR", "OPERATIONS_DIRECTOR"].includes(
    session?.user.accountRole || session?.user.role || "",
  );

  const loadPayments = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/payments?orderId=${orderId}`, {
        cache: "no-store",
      });
      const payload = (await response.json()) as PaymentRecord[] | { error?: string };
      if (!response.ok)
        throw new Error(
          !Array.isArray(payload) && payload.error
            ? payload.error
            : "Не удалось загрузить платежи",
        );
      setPayments(
        (payload as PaymentRecord[]).filter((item) =>
          clientPaymentTypes.has(item.type),
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить платежи",
      );
    } finally {
      setHistoryLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadPayments(), 0);
    return () => window.clearTimeout(timer);
  }, [loadPayments]);

  const mixedTotal = useMemo(
    () => parts.reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [parts],
  );

  async function savePayment() {
    const amount = mixed ? mixedTotal : Number(form.amount);
    const normalizedParts = mixed
      ? parts.map((item) => ({
          method: item.method,
          amount: Number(item.amount),
          reference: item.reference.trim() || undefined,
        }))
      : undefined;

    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 ||
      (normalizedParts &&
        normalizedParts.some(
          (item) =>
            !Number.isFinite(item.amount) ||
            item.amount <= 0 ||
            Math.abs(item.amount * 100 - Math.round(item.amount * 100)) > 1e-7,
        ))
    ) {
      setError("Укажите корректную сумму оплаты с точностью до тиына.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": getKey(),
        },
        body: JSON.stringify({
          orderId,
          amount,
          type: form.type,
          method: form.method,
          parts: normalizedParts,
          comment: form.comment,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        receipt?: { displayNumber?: string } | null;
        receiptPdfStatus?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось принять оплату");

      setForm({
        amount: "",
        type: "Предоплата",
        method: "Kaspi перевод",
        comment: "",
      });
      setParts([
        { method: "Наличные", amount: "", reference: "" },
        { method: "Kaspi перевод", amount: "", reference: "" },
      ]);
      setMixed(false);
      reset();
      setNotice(
        payload.receiptPdfStatus === "FAILED"
          ? `Оплата принята${payload.receipt?.displayNumber ? `, квитанция ${payload.receipt.displayNumber}` : ""}. PDF можно сформировать повторно.`
          : `Оплата принята${payload.receipt?.displayNumber ? ` · ${payload.receipt.displayNumber}` : ""}.`,
      );
      await loadPayments();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось принять оплату",
      );
    } finally {
      setLoading(false);
    }
  }

  async function ensureReceipt(paymentId: number) {
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/payments/${paymentId}/receipt`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        receipt?: { displayNumber?: string };
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сформировать квитанцию");
      setNotice(
        `Квитанция${payload.receipt?.displayNumber ? ` ${payload.receipt.displayNumber}` : ""} готова.`,
      );
      await loadPayments();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось сформировать квитанцию",
      );
    }
  }

  function printReceipt(versionId: number) {
    const target = window.open(
      `/api/document-versions/${versionId}`,
      "_blank",
      "noopener,noreferrer",
    );
    if (!target) setError("Разрешите всплывающие окна для печати квитанции.");
  }

  async function shareReceipt(receipt: Receipt) {
    if (!receipt.publicAccessEnabled) {
      setError("Клиентская ссылка этой квитанции отключена.");
      return;
    }
    const url = `${window.location.origin}/verify/payment-receipt/${receipt.verificationToken}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: `Квитанция ${receipt.displayNumber}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Ссылка на квитанцию скопирована.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError("Не удалось поделиться ссылкой на квитанцию.");
    }
  }

  async function saveRefund() {
    if (!refund) return;
    const normalizedParts = refund.parts.map((item) => ({
      method: item.method,
      amount: Number(item.amount),
      reference: item.reference.trim() || undefined,
    }));
    const amount = normalizedParts.reduce(
      (sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0),
      0,
    );
    const refundable =
      Number(refund.payment.amount) -
      refund.payment.refunds.reduce((sum, item) => sum + Number(item.amount), 0);
    if (
      !refund.reason.trim() ||
      !normalizedParts.length ||
      normalizedParts.some(
        (item) =>
          !Number.isFinite(item.amount) ||
          item.amount <= 0 ||
          Math.abs(item.amount * 100 - Math.round(item.amount * 100)) > 1e-7,
      ) ||
      amount > refundable
    ) {
      setError("Укажите причину и корректную сумму не больше доступного возврата.");
      return;
    }
    const key = refund.key || crypto.randomUUID();
    setRefund({ ...refund, key });
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/payments/${refund.payment.id}/refund`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ amount, parts: normalizedParts, reason: refund.reason }),
      });
      const payload = (await response.json()) as {
        error?: string;
        document?: { id: number; number: string };
        pdfStatus?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось оформить возврат денег");
      setRefund(null);
      setNotice(
        `${payload.document?.number ? `Возврат ${payload.document.number} оформлен` : "Возврат денег оформлен"}${payload.pdfStatus === "FAILED" ? ". PDF можно сформировать повторно." : "."}`,
      );
      await loadPayments();
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось оформить возврат денег",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-5 rounded-2xl border border-slate-700 bg-[#101827] p-4 sm:p-6">
      <div>
        <h2 className="text-xl font-bold text-white">Принять оплату</h2>
        <p className="mt-1 text-sm text-slate-400">
          После записи автоматически создаётся отдельная квитанция.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <select
          className={control}
          value={form.type}
          onChange={(event) => setForm({ ...form, type: event.target.value })}
          aria-label="Тип оплаты"
        >
          <option>Предоплата</option>
          <option>Доплата</option>
        </select>
        <label className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={mixed}
            onChange={(event) => setMixed(event.target.checked)}
            className="size-4"
          />
          Смешанная оплата
        </label>
      </div>

      {mixed ? (
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3">
          {parts.map((part, index) => (
            <div
              key={`${index}-${part.method}`}
              className="grid gap-2 sm:grid-cols-[1fr_0.7fr_1fr_auto]"
            >
              <select
                className={control}
                value={part.method}
                onChange={(event) =>
                  setParts((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, method: event.target.value }
                        : item,
                    ),
                  )
                }
                aria-label={`Способ оплаты ${index + 1}`}
              >
                {methods.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
              <input
                type="number"
                min="0.01"
                step="0.01"
                className={control}
                placeholder="Сумма"
                value={part.amount}
                onChange={(event) =>
                  setParts((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, amount: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <input
                className={control}
                placeholder="Номер / примечание"
                value={part.reference}
                onChange={(event) =>
                  setParts((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index
                        ? { ...item, reference: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              {parts.length > 2 ? (
                <button
                  type="button"
                  onClick={() =>
                    setParts((items) =>
                      items.filter((_, itemIndex) => itemIndex !== index),
                    )
                  }
                  className="min-h-11 rounded-xl border border-red-800 px-3 text-sm text-red-300"
                >
                  Убрать
                </button>
              ) : null}
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() =>
                setParts((items) => [
                  ...items,
                  { method: "Банковская карта", amount: "", reference: "" },
                ])
              }
              className="min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-semibold text-white"
            >
              Добавить способ
            </button>
            <strong className="text-lg text-white">Итого: {money(mixedTotal)}</strong>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <input
            type="number"
            min="0.01"
            step="0.01"
            className={control}
            placeholder="Сумма"
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
          <select
            className={control}
            value={form.method}
            onChange={(event) => setForm({ ...form, method: event.target.value })}
            aria-label="Способ оплаты"
          >
            {methods.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
        </div>
      )}

      <textarea
        className="min-h-24 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-white outline-none focus:border-blue-500"
        placeholder="Комментарий к оплате"
        value={form.comment}
        onChange={(event) => setForm({ ...form, comment: event.target.value })}
      />

      {error || notice ? (
        <p
          role={error ? "alert" : "status"}
          className={`rounded-xl border p-3 text-sm ${
            error
              ? "border-red-800 bg-red-950/40 text-red-300"
              : "border-emerald-800 bg-emerald-950/40 text-emerald-300"
          }`}
        >
          {error || notice}
        </p>
      ) : null}

      <button
        type="button"
        onClick={savePayment}
        disabled={loading}
        className="min-h-12 w-full rounded-xl bg-emerald-700 px-6 font-semibold text-white transition hover:bg-emerald-600 disabled:cursor-wait disabled:opacity-70 sm:w-auto"
      >
        {loading ? "Сохранение..." : "Принять оплату"}
      </button>

      <div className="border-t border-slate-700 pt-5">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h3 className="font-semibold text-white">История платежей</h3>
            <p className="mt-1 text-sm text-slate-400">
              Сотрудник, способ оплаты и связанные документы.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadPayments()}
            className="min-h-10 rounded-xl border border-slate-700 px-3 text-sm text-slate-200"
          >
            Обновить
          </button>
        </div>

        {historyLoading ? (
          <p className="mt-4 text-sm text-slate-400">Загрузка платежей...</p>
        ) : payments.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">
            Платежей по заказу пока нет.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {payments.map((payment) => {
              const version = payment.receipt?.document.versions[0];
              const isRefund = payment.type === "REFUND";
              const refundDocument = payment.documents.find(
                (document) => document.type === "REFUND_CONFIRMATION",
              );
              const refundable = Math.max(
                0,
                Number(payment.amount) -
                  payment.refunds.reduce((sum, item) => sum + Number(item.amount), 0),
              );
              return (
                <li
                  key={payment.id}
                  className="rounded-xl border border-slate-700 bg-slate-950/55 p-3 sm:p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className={isRefund ? "text-amber-200" : "text-white"}>
                          {isRefund ? "Возврат" : "Оплата"} · {money(payment.amount)}
                        </strong>
                        {payment.receipt ? (
                          <span className="rounded-full bg-blue-500/15 px-2 py-1 text-xs text-blue-200">
                            {payment.receipt.displayNumber}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-300">
                        {formatDate(payment.operationDate)} ·{" "}
                        {payment.registeredBy?.name || payment.author || "Сотрудник ORDA"}
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {payment.parts.length > 1
                          ? payment.parts
                              .map((part) => `${part.method}: ${money(part.amount)}`)
                              .join(" · ")
                          : payment.parts[0]?.method || payment.method}
                      </p>
                      {payment.comment ? (
                        <p className="mt-1 text-sm text-slate-500">{payment.comment}</p>
                      ) : null}
                    </div>
                    {!isRefund ? (
                      <div className="flex flex-wrap gap-2 sm:max-w-xl sm:justify-end">
                        {payment.receipt ? (
                          <Link
                            href={`/documents/${payment.receipt.documentId}`}
                            className="inline-flex min-h-10 items-center rounded-xl bg-blue-700 px-3 text-sm font-semibold text-white"
                          >
                            Квитанция
                          </Link>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void ensureReceipt(payment.id)}
                            className="min-h-10 rounded-xl bg-blue-700 px-3 text-sm font-semibold text-white"
                          >
                            Квитанция
                          </button>
                        )}
                        {version ? (
                          <>
                            <a
                              href={`/api/document-versions/${version.id}?download=1`}
                              className="inline-flex min-h-10 items-center rounded-xl border border-slate-600 px-3 text-sm text-white"
                            >
                              Скачать PDF
                            </a>
                            <button
                              type="button"
                              onClick={() => printReceipt(version.id)}
                              className="min-h-10 rounded-xl border border-slate-600 px-3 text-sm text-white"
                            >
                              Распечатать
                            </button>
                          </>
                        ) : null}
                        {payment.receipt ? (
                          <button
                            type="button"
                            onClick={() => void shareReceipt(payment.receipt!)}
                            className="min-h-10 rounded-xl border border-slate-600 px-3 text-sm text-white"
                          >
                            Поделиться
                          </button>
                        ) : null}
                        {canRefund && refundable > 0 ? (
                          <button
                            type="button"
                            onClick={() => {
                              setRefund({
                                payment,
                                reason: "",
                                parts: [
                                  {
                                    method: payment.parts[0]?.method || payment.method,
                                    amount: String(refundable),
                                    reference: "",
                                  },
                                ],
                                key: "",
                              });
                              setError("");
                              setNotice("");
                            }}
                            className="min-h-10 rounded-xl border border-amber-700/60 px-3 text-sm text-amber-200"
                          >
                            Оформить возврат
                          </button>
                        ) : null}
                      </div>
                    ) : refundDocument ? (
                      <div className="flex flex-wrap gap-2 sm:justify-end">
                        <Link
                          href={`/documents/${refundDocument.id}`}
                          className="inline-flex min-h-10 items-center rounded-xl bg-amber-700 px-3 text-sm font-semibold text-white"
                        >
                          Подтверждение возврата
                        </Link>
                        {refundDocument.versions[0] ? (
                          <a
                            href={`/api/document-versions/${refundDocument.versions[0].id}?download=1`}
                            className="inline-flex min-h-10 items-center rounded-xl border border-slate-600 px-3 text-sm text-white"
                          >
                            Скачать PDF
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        )}

        {refund ? (
          <div className="mt-4 space-y-3 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
            <div>
              <h4 className="font-semibold text-white">Возврат денег по оплате {money(refund.payment.amount)}</h4>
              <p className="mt-1 text-sm text-amber-100/80">
                Возврат товара и возврат денег — отдельные операции. Здесь изменяется только финансовый учёт.
              </p>
            </div>
            <input
              className={control}
              value={refund.reason}
              onChange={(event) => setRefund({ ...refund, reason: event.target.value })}
              placeholder="Причина возврата"
            />
            <div className="space-y-2">
              {refund.parts.map((part, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_10rem_1fr_auto]">
                  <select
                    className={control}
                    value={part.method}
                    onChange={(event) =>
                      setRefund({
                        ...refund,
                        parts: refund.parts.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, method: event.target.value }
                            : item,
                        ),
                      })
                    }
                  >
                    {methods.map((method) => (
                      <option key={method}>{method}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={control}
                    value={part.amount}
                    onChange={(event) =>
                      setRefund({
                        ...refund,
                        parts: refund.parts.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, amount: event.target.value }
                            : item,
                        ),
                      })
                    }
                    placeholder="Сумма"
                  />
                  <input
                    className={control}
                    value={part.reference}
                    onChange={(event) =>
                      setRefund({
                        ...refund,
                        parts: refund.parts.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, reference: event.target.value }
                            : item,
                        ),
                      })
                    }
                    placeholder="Номер / примечание"
                  />
                  {refund.parts.length > 1 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setRefund({
                          ...refund,
                          parts: refund.parts.filter((_, itemIndex) => itemIndex !== index),
                        })
                      }
                      className="min-h-11 rounded-xl border border-red-800 px-3 text-sm text-red-300"
                    >
                      Убрать
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() =>
                  setRefund({
                    ...refund,
                    parts: [
                      ...refund.parts,
                      { method: "Наличные", amount: "", reference: "" },
                    ],
                  })
                }
                className="min-h-11 rounded-xl border border-slate-600 px-4 text-sm text-white"
              >
                Добавить способ
              </button>
              <button
                type="button"
                onClick={() => void saveRefund()}
                disabled={loading}
                className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-60"
              >
                {loading ? "Проведение..." : "Провести возврат денег"}
              </button>
              <button
                type="button"
                onClick={() => setRefund(null)}
                className="min-h-11 rounded-xl border border-slate-700 px-4 text-slate-200"
              >
                Отмена
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
