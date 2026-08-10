"use client";

import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileArchive,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type Version = {
  id: number;
  version: number;
  fileName: string;
  size: number;
  checksum: string;
  pdfFileName?: string | null;
  pdfSize?: number | null;
  pdfChecksum?: string | null;
  pdfStatus?: "NOT_REQUESTED" | "PENDING" | "READY" | "FAILED";
  pdfErrorCode?: string | null;
};
type PackageData = {
  contract: {
    id: number;
    number: string;
    status: string;
    currentVersion: number;
    signedAt: string | null;
    signedFileName: string | null;
    versions: Version[];
  };
  memo: {
    id: number;
    status: string;
    currentVersion: number;
    signedAt: string | null;
    signedFileName: string | null;
    versions: Version[];
  } | null;
  acknowledgement: {
    acknowledgedAt: string;
    memoVersion: number;
    acknowledgedBy: { id: number; name: string };
  } | null;
  receipts: Array<{
    id: number;
    receiptNumber: number;
    status: "ACTIVE" | "VOID";
    documentId: number;
    createdAt: string;
    voidedAt: string | null;
    voidReason: string | null;
    verificationPath: string;
    shift: {
      id: number;
      shiftNumber: number;
      status: "OPEN" | "CLOSED";
      responsibleManager: string;
    };
    version: Version | null;
  }>;
};

export default function ContractPackageCard({
  orderId,
  revision,
  readOnly,
  onCreate,
}: {
  orderId: number;
  revision: number;
  readOnly: boolean;
  onCreate: () => void;
}) {
  const { data: session } = useSession();
  const [data, setData] = useState<PackageData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [signedMemo, setSignedMemo] = useState<File | null>(null);

  const load = useCallback(async () => {
    const response = await fetch(`/api/orders/${orderId}/contract-package`, {
      cache: "no-store",
    });
    const payload = (await response.json()) as {
      package?: PackageData | null;
      error?: string;
    };
    if (response.ok) setData(payload.package ?? null);
    else setError(payload.error ?? "Не удалось загрузить комплект");
    setLoaded(true);
  }, [orderId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, revision]);

  async function action(
    name: "ensure" | "retry-contract-pdf" | "acknowledge-memo",
  ) {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${orderId}/contract-package`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: name,
          contractDocumentId: data.contract.id,
        }),
      });
      const payload = (await response.json()) as {
        package?: PackageData;
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось выполнить действие");
      setData(payload.package ?? null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось выполнить действие",
      );
    } finally {
      setBusy(false);
    }
  }

  async function uploadMemo() {
    if (!data?.memo || !signedMemo) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", signedMemo);
      form.set("comment", "Подписанная памятка заказчику");
      const response = await fetch(`/api/documents/${data.memo.id}/signed`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось загрузить памятку");
      setSignedMemo(null);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось загрузить памятку",
      );
    } finally {
      setBusy(false);
    }
  }

  async function retryReceipt(id: number) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/payment-receipts/${id}/generate`, {
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok)
      setError(payload.error ?? "Не удалось сформировать квитанцию");
    await load();
    setBusy(false);
  }

  async function closeShift(id: number) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/cash-shifts/${id}/close`, {
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) setError(payload.error ?? "Не удалось закрыть смену");
    await load();
    setBusy(false);
  }

  if (!loaded)
    return (
      <div className="mb-5 rounded-2xl border border-slate-700 bg-slate-950/40 p-5 text-slate-400">
        Загрузка договорного комплекта…
      </div>
    );
  if (!data)
    return (
      <section className="mb-5 rounded-2xl border border-[#b68a3a]/40 bg-[#171710] p-5">
        <FileArchive className="text-[#d8b873]" />
        <h3 className="mt-3 text-xl font-bold text-white">
          Договорный комплект
        </h3>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
          Основной PDF: 2 страницы договора и отдельная страница памятки.
          DOCX сохраняется дополнительно, квитанции создаются только по
          подтверждённым оплатам.
        </p>
        {!readOnly && (
          <button
            type="button"
            onClick={onCreate}
            className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold text-white"
          >
            <FileCheck2 size={18} />
            Сформировать комплект документов
          </button>
        )}
        {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      </section>
    );

  const contract = data.contract.versions.find(
    (item) => item.version === data.contract.currentVersion,
  );
  const memo = data.memo?.versions.find(
    (item) => item.version === data.memo?.currentVersion,
  );
  return (
    <section className="mb-5 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/35">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-700 bg-[#171710] p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#d8b873]">
            ALTYN SAPA COMPANY
          </p>
          <h3 className="mt-1 text-xl font-bold text-white">
            Договорный комплект
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            Договор №{data.contract.number}
          </p>
        </div>
        <a
          href={`/api/orders/${orderId}/contract-package/download`}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-700 px-4 font-semibold text-white"
        >
          <FileArchive size={18} />
          Скачать комплект
        </a>
      </div>
      {error && (
        <p
          role="alert"
          className="m-4 rounded-xl border border-red-800 bg-red-950/30 p-3 text-sm text-red-300"
        >
          {error}
        </p>
      )}
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <article className="rounded-xl border border-slate-700 bg-[#101827] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-white">
                Договор №{data.contract.number}
              </h4>
              <p className="mt-1 text-sm text-emerald-300">
                PDF основной · 2 страницы договора + памятка · DOCX дополнительно
              </p>
            </div>
            <FileCheck2 className="text-[#d8b873]" />
          </div>
          {contract && (
            <div className="mt-4 flex flex-wrap gap-2">
              {contract.pdfStatus === "READY" && (
                <>
                  <a
                    target="_blank"
                    href={`/api/document-versions/${contract.id}?representation=pdf`}
                    className="action primary"
                  >
                    <ExternalLink size={16} />
                    Открыть PDF
                  </a>
                  <a
                    href={`/api/document-versions/${contract.id}?representation=pdf&download=1`}
                    className="action"
                  >
                    <Download size={16} />
                    Скачать PDF
                  </a>
                </>
              )}
              <a
                href={`/api/document-versions/${contract.id}?download=1`}
                className="action"
              >
                <Download size={16} />
                Скачать DOCX
              </a>
            </div>
          )}
          {contract?.pdfStatus !== "READY" && (
            <div className="mt-4 rounded-xl border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-200">
              <p>PDF не сформирован.</p>
              {!readOnly && (
                <button
                  disabled={busy}
                  onClick={() => void action("retry-contract-pdf")}
                  className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-800 px-3 font-semibold text-white disabled:opacity-50"
                >
                  <RefreshCw size={15} />
                  {contract?.pdfStatus === "FAILED"
                    ? "Повторить формирование PDF"
                    : "Сформировать PDF"}
                </button>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href={`/documents/${data.contract.id}`} className="action">
              <Upload size={16} />
              {data.contract.signedFileName
                ? "Открыть подписанный оригинал"
                : "Загрузить подписанный оригинал"}
            </Link>
            {data.contract.signedFileName && (
              <a
                target="_blank"
                href={`/api/documents/${data.contract.id}/signed`}
                className="action"
              >
                <ExternalLink size={16} />
                Подписанная копия
              </a>
            )}
          </div>
        </article>
        <article className="rounded-xl border border-slate-700 bg-[#101827] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-white">Памятка заказчику</h4>
              <p className="mt-1 text-sm text-emerald-300">
                1 страница A4 · обязательное ознакомление
              </p>
            </div>
            <ShieldCheck className="text-[#d8b873]" />
          </div>
          {memo && (
            <div className="mt-4 flex flex-wrap gap-2">
              <a
                target="_blank"
                href={`/api/document-versions/${memo.id}`}
                className="action primary"
              >
                <ExternalLink size={16} />
                Открыть
              </a>
              <a
                href={`/api/document-versions/${memo.id}?download=1`}
                className="action"
              >
                <Download size={16} />
                Скачать
              </a>
            </div>
          )}
          <div
            className={`mt-4 rounded-xl border p-3 text-sm ${data.acknowledgement ? "border-emerald-800 bg-emerald-950/20 text-emerald-200" : "border-amber-800 bg-amber-950/20 text-amber-200"}`}
          >
            {data.acknowledgement ? (
              <p className="flex items-center gap-2">
                <CheckCircle2 size={17} />
                Памятка передана и разъяснена ·{" "}
                {data.acknowledgement.acknowledgedBy.name}
              </p>
            ) : (
              <>
                <p>
                  Памятка ещё не подтверждена. Без этого договор нельзя отметить
                  подписанным.
                </p>
                {!readOnly && (
                  <button
                    disabled={busy}
                    onClick={() => void action("acknowledge-memo")}
                    className="mt-2 min-h-10 rounded-lg bg-emerald-700 px-3 font-semibold text-white disabled:opacity-50"
                  >
                    Подтвердить ознакомление
                  </button>
                )}
              </>
            )}
          </div>
          {!readOnly && data.memo && (
            <div className="mt-4">
              <label className="block text-xs text-slate-400">
                Фото или скан подписанной памятки
              </label>
              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(event) =>
                  setSignedMemo(event.target.files?.[0] ?? null)
                }
                className="mt-2 block w-full text-xs text-slate-300 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-white"
              />
              <button
                disabled={busy || !signedMemo}
                onClick={() => void uploadMemo()}
                className="mt-2 inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-700 px-3 font-semibold text-white disabled:opacity-40"
              >
                <Upload size={15} />
                Загрузить подписанную памятку
              </button>
              {data.memo.signedFileName && (
                <a
                  target="_blank"
                  href={`/api/documents/${data.memo.id}/signed`}
                  className="ml-2 inline-flex min-h-10 items-center gap-2 text-emerald-300"
                >
                  <ExternalLink size={15} />
                  Открыть
                </a>
              )}
            </div>
          )}
        </article>
      </div>
      <div className="border-t border-slate-700 p-4">
        <h4 className="font-bold text-white">Квитанции об оплате</h4>
        {data.receipts.length ? (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {data.receipts.map((receipt) => (
              <article
                key={receipt.id}
                className="rounded-xl border border-slate-700 bg-[#101827] p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <strong className="text-white">
                      Квитанция №{receipt.receiptNumber}
                    </strong>
                    <p
                      className={`mt-1 text-sm ${receipt.status === "VOID" ? "text-red-300" : "text-emerald-300"}`}
                    >
                      {receipt.status === "VOID"
                        ? "Аннулирована"
                        : "Действительна"}
                    </p>
                    {receipt.status === "VOID" && (
                      <p className="mt-1 text-xs text-red-200">
                        Сторнирована{" "}
                        {receipt.voidedAt
                          ? new Date(receipt.voidedAt).toLocaleString("ru-RU")
                          : ""}
                        {receipt.voidReason ? ` · ${receipt.voidReason}` : ""}
                      </p>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      Внутренняя смена №{receipt.shift.shiftNumber} ·{" "}
                      {receipt.shift.responsibleManager} ·{" "}
                      {receipt.shift.status === "OPEN" ? "открыта" : "закрыта"}
                    </p>
                  </div>
                  <span className="text-xs text-slate-500">
                    Нефискальный документ
                  </span>
                </div>
                {receipt.version ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      target="_blank"
                      href={`/api/document-versions/${receipt.version.id}`}
                      className="action primary"
                    >
                      <ExternalLink size={15} />
                      Открыть PDF
                    </a>
                    <a
                      href={`/api/document-versions/${receipt.version.id}?download=1`}
                      className="action"
                    >
                      <Download size={15} />
                      Скачать PDF
                    </a>
                    <a
                      target="_blank"
                      href={receipt.verificationPath}
                      className="action"
                    >
                      <ShieldCheck size={15} />
                      Проверить QR
                    </a>
                    {session?.user.role === "DIRECTOR" &&
                      receipt.shift.status === "OPEN" && (
                        <button
                          disabled={busy}
                          onClick={() => void closeShift(receipt.shift.id)}
                          className="action"
                        >
                          Закрыть смену
                        </button>
                      )}
                  </div>
                ) : (
                  <button
                    disabled={busy}
                    onClick={() => void retryReceipt(receipt.id)}
                    className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg bg-amber-800 px-3 text-sm font-semibold text-white"
                  >
                    <RefreshCw size={15} />
                    Сформировать PDF
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 rounded-xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
            Квитанция будет сформирована после подтверждения оплаты.
          </p>
        )}
      </div>
      <style jsx>{`
        .action {
          display: inline-flex;
          min-height: 2.5rem;
          align-items: center;
          gap: 0.4rem;
          border-radius: 0.6rem;
          background: #334155;
          padding: 0.45rem 0.7rem;
          font-size: 0.8rem;
          font-weight: 600;
          color: white;
        }
        .action.primary {
          background: #2563eb;
        }
      `}</style>
    </section>
  );
}
