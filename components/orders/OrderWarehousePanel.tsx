"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { OrderTabData } from "./tabs/types";

type WarehouseItem = NonNullable<OrderTabData["items"]>[number];
type Shipment = NonNullable<OrderTabData["warehouseShipments"]>[number];

type Props = {
  orderId: number;
  clientName: string;
  items: WarehouseItem[];
  shipments: Shipment[];
  readOnly?: boolean;
  canReturn?: boolean;
};

type Location = { id: number; name: string; address: string };

const control =
  "min-h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-white outline-none focus:border-blue-500";

function quantity(value: unknown) {
  return Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 3 });
}

function money(value: unknown) {
  return `${Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₸`;
}

function date(value: Date | string) {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Almaty",
  }).format(new Date(value));
}

export default function OrderWarehousePanel({
  orderId,
  clientName,
  items,
  shipments,
  readOnly = false,
  canReturn = false,
}: Props) {
  const router = useRouter();
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState("");
  const [recipientName, setRecipientName] = useState(clientName);
  const [issueOpen, setIssueOpen] = useState(false);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [requestKey, setRequestKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [createdDocumentId, setCreatedDocumentId] = useState<number | null>(null);
  const [createdDocumentLabel, setCreatedDocumentLabel] = useState("Открыть документ");
  const [release, setRelease] = useState<{
    item: WarehouseItem;
    location: { id: number; name: string };
    quantity: string;
    reason: string;
    key: string;
  } | null>(null);
  const [returnDraft, setReturnDraft] = useState<{
    shipment: Shipment;
    locationId: string;
    reason: string;
    quantities: Record<number, string>;
    conditions: Record<number, "SELLABLE" | "DAMAGED">;
    key: string;
  } | null>(null);
  const returnOpen = returnDraft !== null;

  const trackedItems = useMemo(
    () => items.filter((item) => item.stockTracked && item.materialId),
    [items],
  );
  const openItems = useMemo(
    () =>
      trackedItems.filter(
        (item) => Number(item.quantity) - Number(item.issuedQuantity) > 0.000001,
      ),
    [trackedItems],
  );

  const loadLocations = useCallback(async () => {
    try {
      const response = await fetch("/api/warehouse/locations", { cache: "no-store" });
      const payload = (await response.json()) as {
        error?: string;
        locations?: Location[];
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось загрузить места хранения");
      const available = payload.locations ?? [];
      setLocations(available);
      setLocationId((current) => current || String(available[0]?.id ?? ""));
      setReturnDraft((current) =>
        current && !current.locationId
          ? { ...current, locationId: String(available[0]?.id ?? "") }
          : current,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось загрузить места хранения",
      );
    }
  }, []);

  useEffect(() => {
    if (!issueOpen && !returnOpen) return;
    const timer = window.setTimeout(() => void loadLocations(), 0);
    return () => window.clearTimeout(timer);
  }, [issueOpen, returnOpen, loadLocations]);

  function fillRemaining() {
    setAmounts(
      Object.fromEntries(
        openItems.map((item) => [
          item.id,
          String(Number(item.quantity) - Number(item.issuedQuantity)),
        ]),
      ),
    );
  }

  async function issue() {
    const lines = openItems
      .map((item) => ({ orderItemId: item.id, quantity: Number(amounts[item.id]) }))
      .filter((item) => Number.isFinite(item.quantity) && item.quantity > 0);
    if (!Number.isInteger(Number(locationId)) || !lines.length) {
      setError("Выберите место хранения и количество к выдаче.");
      return;
    }
    const exceeds = lines.some((line) => {
      const item = openItems.find((candidate) => candidate.id === line.orderItemId)!;
      return (
        line.quantity > Number(item.quantity) - Number(item.issuedQuantity) ||
        Math.abs(line.quantity * 1000 - Math.round(line.quantity * 1000)) > 1e-7
      );
    });
    if (exceeds) {
      setError("Количество к выдаче превышает остаток заказа или точность единицы.");
      return;
    }
    const key = requestKey || crypto.randomUUID();
    if (!requestKey) setRequestKey(key);
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/warehouse/shipments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          orderId,
          locationId: Number(locationId),
          recipientName: recipientName.trim() || undefined,
          lines,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        number?: string;
        documentId?: number;
        pdfStatus?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось провести выдачу");
      setCreatedDocumentId(payload.documentId ?? null);
      setCreatedDocumentLabel("Открыть накладную");
      setNotice(
        `${payload.number ? `Выдача ${payload.number} проведена` : "Выдача проведена"}${payload.pdfStatus === "FAILED" ? ". PDF накладной можно сформировать повторно." : "."}`,
      );
      setIssueOpen(false);
      setAmounts({});
      setRequestKey("");
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось провести выдачу",
      );
    } finally {
      setLoading(false);
    }
  }

  async function releaseReservation() {
    if (!release) return;
    const value = Number(release.quantity);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value > Number(release.item.reservedQuantity)
    ) {
      setError("Укажите количество не больше действующего резерва.");
      return;
    }
    const key = release.key || crypto.randomUUID();
    setRelease({ ...release, key });
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/warehouse/reservations/release", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          orderItemId: release.item.id,
          locationId: release.location.id,
          quantity: value,
          reason: release.reason.trim() || undefined,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось снять резерв");
      setRelease(null);
      setNotice("Резерв снят. Физический остаток не изменён.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось снять резерв");
    } finally {
      setLoading(false);
    }
  }

  async function acceptReturn() {
    if (!returnDraft) return;
    const availableLines = returnDraft.shipment.lines.filter(
      (line) =>
        Number(line.quantity) -
          line.returnLines.reduce((sum, item) => sum + Number(item.quantity), 0) >
        0.000001,
    );
    const lines = availableLines
      .map((line) => ({
        shipmentLineId: line.id,
        quantity: Number(returnDraft.quantities[line.id]),
        condition: returnDraft.conditions[line.id] ?? "SELLABLE",
      }))
      .filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    const invalid = lines.some((line) => {
      const source = availableLines.find((item) => item.id === line.shipmentLineId)!;
      const alreadyReturned = source.returnLines.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      );
      return (
        line.quantity > Number(source.quantity) - alreadyReturned ||
        Math.abs(line.quantity * 1000 - Math.round(line.quantity * 1000)) > 1e-7
      );
    });
    if (
      !returnDraft.reason.trim() ||
      !Number.isInteger(Number(returnDraft.locationId)) ||
      !lines.length ||
      invalid
    ) {
      setError("Укажите причину, место и корректное количество фактически принятого товара.");
      return;
    }
    const key = returnDraft.key || crypto.randomUUID();
    setReturnDraft({ ...returnDraft, key });
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/warehouse/returns", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({
          shipmentId: returnDraft.shipment.id,
          locationId: Number(returnDraft.locationId),
          reason: returnDraft.reason.trim(),
          lines,
        }),
      });
      const payload = (await response.json()) as {
        error?: string;
        number?: string;
        documentId?: number;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось принять возврат товара");
      setCreatedDocumentId(payload.documentId ?? null);
      setCreatedDocumentLabel("Открыть документ возврата");
      setReturnDraft(null);
      setNotice(
        `${payload.number ? `Возврат ${payload.number} проведён` : "Возврат товара проведён"}. Денежный возврат оформляется отдельно.`,
      );
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось принять возврат товара",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-2xl border border-slate-800 bg-[#101827] shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-800 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Товары и выдача</h2>
          <p className="mt-1 text-sm text-slate-400">
            Заказано, в резерве, выдано и осталось выдать.
          </p>
        </div>
        {!readOnly && openItems.length ? (
          <button
            type="button"
            onClick={() => {
              setIssueOpen((value) => !value);
              setError("");
              setNotice("");
            }}
            className="min-h-11 rounded-xl bg-blue-700 px-4 font-semibold text-white hover:bg-blue-600"
          >
            Выдать товар
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 md:p-5 xl:grid-cols-3">
        {trackedItems.map((item) => {
          const remaining = Math.max(
            0,
            Number(item.quantity) - Number(item.issuedQuantity),
          );
          const activeReservations = item.reservations.filter(
            (reservation) => reservation.status === "ACTIVE" && reservation.quantity > 0,
          );
          return (
            <article key={item.id} className="rounded-xl border border-slate-700 bg-slate-950/55 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {item.skuSnapshot}
              </p>
              <h3 className="mt-1 font-semibold text-white">{item.nameSnapshot}</h3>
              {item.variantSnapshot ? (
                <p className="mt-1 text-sm text-slate-400">{item.variantSnapshot}</p>
              ) : null}
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <span className="rounded-lg bg-slate-900 p-2 text-slate-300">
                  Заказано<br />
                  <strong className="text-white">
                    {quantity(item.quantity)} {item.unitSnapshot}
                  </strong>
                </span>
                <span className="rounded-lg bg-slate-900 p-2 text-slate-300">
                  Резерв<br />
                  <strong className="text-white">
                    {quantity(item.reservedQuantity)} {item.unitSnapshot}
                  </strong>
                </span>
                <span className="rounded-lg bg-slate-900 p-2 text-slate-300">
                  Выдано<br />
                  <strong className="text-white">
                    {quantity(item.issuedQuantity)} {item.unitSnapshot}
                  </strong>
                </span>
                <span className="rounded-lg bg-slate-900 p-2 text-slate-300">
                  Осталось<br />
                  <strong className="text-white">
                    {quantity(remaining)} {item.unitSnapshot}
                  </strong>
                </span>
              </div>
              <p className="mt-3 text-sm text-slate-300">
                {money(item.lineTotal)}
              </p>
              {!readOnly
                ? activeReservations.map((reservation) =>
                    reservation.location ? (
                      <button
                        key={reservation.id}
                        type="button"
                        onClick={() =>
                          setRelease({
                            item,
                            location: reservation.location!,
                            quantity: String(reservation.quantity),
                            reason: "",
                            key: "",
                          })
                        }
                        className="mt-3 min-h-10 w-full rounded-xl border border-amber-700/60 px-3 text-sm text-amber-200"
                      >
                        Снять резерв · {reservation.location.name}
                      </button>
                    ) : null,
                  )
                : null}
            </article>
          );
        })}
      </div>

      {issueOpen ? (
        <div className="space-y-4 border-t border-slate-800 p-4 md:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-white">Фактическая выдача</h3>
            <button
              type="button"
              onClick={fillRemaining}
              className="min-h-10 rounded-xl border border-slate-700 px-3 text-sm text-slate-200"
            >
              Выдать всё оставшееся
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className={control}
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
              aria-label="Место выдачи"
            >
              <option value="">Выберите место хранения</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <input
              className={control}
              value={recipientName}
              onChange={(event) => setRecipientName(event.target.value)}
              placeholder="Получил: ФИО"
            />
          </div>
          <div className="space-y-2">
            {openItems.map((item) => {
              const remaining = Number(item.quantity) - Number(item.issuedQuantity);
              return (
                <label
                  key={item.id}
                  className="grid gap-2 rounded-xl border border-slate-700 bg-slate-950/55 p-3 sm:grid-cols-[1fr_12rem] sm:items-center"
                >
                  <span className="text-sm text-slate-200">
                    <strong className="text-white">{item.nameSnapshot}</strong>
                    {item.variantSnapshot ? ` · ${item.variantSnapshot}` : ""}
                    <span className="mt-1 block text-slate-500">
                      Осталось {quantity(remaining)} {item.unitSnapshot}
                    </span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={remaining}
                    step="0.001"
                    className={control}
                    placeholder="Количество"
                    value={amounts[item.id] ?? ""}
                    onChange={(event) =>
                      setAmounts((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                </label>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void issue()}
            disabled={loading}
            className="min-h-12 w-full rounded-xl bg-blue-700 px-5 font-semibold text-white disabled:opacity-60 sm:w-auto"
          >
            {loading ? "Проведение..." : "Провести выдачу и создать накладную"}
          </button>
        </div>
      ) : null}

      {release ? (
        <div className="space-y-3 border-t border-slate-800 p-4 md:p-5">
          <h3 className="font-semibold text-white">Снять резерв</h3>
          <p className="text-sm text-slate-400">
            {release.item.nameSnapshot} · {release.location.name}. Физический остаток не изменится.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <input
              type="number"
              min="0.001"
              step="0.001"
              max={Number(release.item.reservedQuantity)}
              className={control}
              value={release.quantity}
              onChange={(event) => setRelease({ ...release, quantity: event.target.value })}
              aria-label="Количество для снятия резерва"
            />
            <input
              className={control}
              value={release.reason}
              onChange={(event) => setRelease({ ...release, reason: event.target.value })}
              placeholder="Причина (необязательно)"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void releaseReservation()}
              disabled={loading}
              className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Сохранение..." : "Подтвердить снятие"}
            </button>
            <button
              type="button"
              onClick={() => setRelease(null)}
              className="min-h-11 rounded-xl border border-slate-700 px-4 text-slate-200"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {returnDraft ? (
        <div className="space-y-4 border-t border-slate-800 p-4 md:p-5">
          <div>
            <h3 className="font-semibold text-white">Возврат товара по {returnDraft.shipment.number}</h3>
            <p className="mt-1 text-sm text-slate-400">
              Отметьте только фактически принятый товар. Повреждённый товар попадёт в недоступное место хранения.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <select
              className={control}
              value={returnDraft.locationId}
              onChange={(event) =>
                setReturnDraft({ ...returnDraft, locationId: event.target.value })
              }
              aria-label="Место приёма возврата"
            >
              <option value="">Выберите место хранения</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
            <input
              className={control}
              value={returnDraft.reason}
              onChange={(event) =>
                setReturnDraft({ ...returnDraft, reason: event.target.value })
              }
              placeholder="Причина возврата"
            />
          </div>
          <div className="space-y-2">
            {returnDraft.shipment.lines.map((line) => {
              const item = items.find((value) => value.id === line.orderItemId);
              const returned = line.returnLines.reduce(
                (sum, value) => sum + Number(value.quantity),
                0,
              );
              const maximum = Math.max(0, Number(line.quantity) - returned);
              if (maximum <= 0) return null;
              return (
                <div
                  key={line.id}
                  className="grid gap-2 rounded-xl border border-slate-700 bg-slate-950/55 p-3 sm:grid-cols-[1fr_9rem_11rem] sm:items-center"
                >
                  <span className="text-sm text-slate-300">
                    <strong className="text-white">
                      {item?.nameSnapshot ?? `Позиция ${line.orderItemId}`}
                    </strong>
                    <span className="mt-1 block text-slate-500">
                      Можно вернуть: {quantity(maximum)} {item?.unitSnapshot ?? ""}
                    </span>
                  </span>
                  <input
                    type="number"
                    min="0"
                    max={maximum}
                    step="0.001"
                    className={control}
                    value={returnDraft.quantities[line.id] ?? ""}
                    onChange={(event) =>
                      setReturnDraft({
                        ...returnDraft,
                        quantities: {
                          ...returnDraft.quantities,
                          [line.id]: event.target.value,
                        },
                      })
                    }
                    placeholder="Количество"
                  />
                  <select
                    className={control}
                    value={returnDraft.conditions[line.id] ?? "SELLABLE"}
                    onChange={(event) =>
                      setReturnDraft({
                        ...returnDraft,
                        conditions: {
                          ...returnDraft.conditions,
                          [line.id]: event.target.value as "SELLABLE" | "DAMAGED",
                        },
                      })
                    }
                  >
                    <option value="SELLABLE">Пригоден к продаже</option>
                    <option value="DAMAGED">Повреждён</option>
                  </select>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void acceptReturn()}
              disabled={loading}
              className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-60"
            >
              {loading ? "Проведение..." : "Принять товар на склад"}
            </button>
            <button
              type="button"
              onClick={() => setReturnDraft(null)}
              className="min-h-11 rounded-xl border border-slate-700 px-4 text-slate-200"
            >
              Отмена
            </button>
          </div>
        </div>
      ) : null}

      {error || notice ? (
        <div className="border-t border-slate-800 p-4 md:px-5">
          <p
            role={error ? "alert" : "status"}
            className={`rounded-xl border p-3 text-sm ${
              error
                ? "border-red-800 bg-red-950/40 text-red-300"
                : "border-emerald-800 bg-emerald-950/40 text-emerald-300"
            }`}
          >
            {error || notice}
            {createdDocumentId ? (
              <Link
                href={`/documents/${createdDocumentId}`}
                className="ml-2 font-semibold underline"
              >
                {createdDocumentLabel}
              </Link>
            ) : null}
          </p>
        </div>
      ) : null}

      {shipments.length ? (
        <div className="border-t border-slate-800 p-4 md:p-5">
          <h3 className="font-semibold text-white">Проведённые выдачи</h3>
          <div className="mt-3 space-y-2">
            {shipments.map((shipment) => (
              <div
                key={shipment.id}
                className="flex flex-col gap-2 rounded-xl bg-slate-950/55 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-sm text-slate-300">
                  <strong className="text-white">{shipment.number}</strong> · {date(shipment.shippedAt)}
                  <span className="mt-1 block text-slate-500">
                    {shipment.location.name} · отпустил {shipment.issuedBy.name}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/documents/${shipment.documentId}`}
                    className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600 px-3 text-sm font-semibold text-white"
                  >
                    Накладная
                  </Link>
                  {canReturn && shipment.lines.some((line) => Number(line.quantity) - line.returnLines.reduce((sum, value) => sum + Number(value.quantity), 0) > 0.000001) ? (
                    <button
                      type="button"
                      onClick={() => {
                        setReturnDraft({ shipment, locationId: locationId || "", reason: "", quantities: {}, conditions: {}, key: "" });
                        setError("");
                        setNotice("");
                      }}
                      className="min-h-10 rounded-xl border border-amber-700/60 px-3 text-sm font-semibold text-amber-200"
                    >
                      Принять возврат
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
