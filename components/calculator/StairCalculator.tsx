"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";

type Tariff = { code: string; uiName: string; kind: string; unit: string; salePrice: number; internalPrice?: number; defaultQuantity: number; manualPriceAllowed: boolean };
type CalculationLineInput = { code: string; kind: string; name: string; quantity: number; unit: string; unitCost: number; unitSale: number; comment?: string; enabled?: boolean };

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default function StairCalculator({ orderId }: { orderId?: number }) {
  const { data: session } = useSession();
  const [targetOrderId, setTargetOrderId] = useState(
    orderId ? String(orderId) : "",
  );
  const [material, setMaterial] = useState("Карагач");
  const [regularSteps, setRegularSteps] = useState("18");
  const [platforms, setPlatforms] = useState<number[]>([2]);
  const [clientOverride, setClientOverride] = useState("");
  const [workshopOverride, setWorkshopOverride] = useState("");
  const [installationRequired, setInstallationRequired] = useState(true);
  const [deliveryRequired, setDeliveryRequired] = useState(true);
  const [otherCity, setOtherCity] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [lines, setLines] = useState<CalculationLineInput[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [savedOrderId, setSavedOrderId] = useState<number | null>(null);
  const isDirector = session?.user.role === "DIRECTOR";
  const canSeeInternal = isDirector || session?.user.role === "ACCOUNTANT";
  useEffect(() => {
    void fetch("/api/calculator-pricing", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { items?: Tariff[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Тарифы недоступны");
      setTariffs(payload.items ?? []);
    }).catch((error) => setMessage(error instanceof Error ? error.message : "Тарифы недоступны"));
  }, []);
  const materialTariffs = tariffs.filter((item) => item.kind === "STAIR_MATERIAL");
  const positionTariffs = tariffs.filter((item) => item.kind !== "STAIR_MATERIAL");
  const calculation = useMemo(() => {
    const tariff = materialTariffs.find((item) => item.uiName === material);
    const steps = Number(regularSteps);
    if (!tariff || !Number.isInteger(steps) || steps < 0 || platforms.some((value) => value !== 2 && value !== 3)) return null;
    const equivalentSteps = steps + platforms.reduce((sum, value) => sum + value, 0);
    const enabledLines = lines.map((line) => ({ ...line, enabled: line.enabled !== false && (line.kind !== "INSTALLATION" || installationRequired) && (line.kind !== "DELIVERY" || (deliveryRequired && !pickup)) }));
    const lineSale = enabledLines.reduce((sum, line) => sum + (line.enabled ? line.quantity * line.unitSale : 0), 0);
    const lineCost = enabledLines.reduce((sum, line) => sum + (line.enabled ? line.quantity * line.unitCost : 0), 0);
    const baseClientPrice = equivalentSteps * tariff.salePrice + lineSale;
    const baseWorkshopCost = equivalentSteps * (tariff.internalPrice ?? 0) + lineCost;
    const clientPrice = clientOverride === "" ? baseClientPrice : Number(clientOverride);
    const workshopCost = workshopOverride === "" ? baseWorkshopCost : Number(workshopOverride);
    if (![clientPrice, workshopCost].every((value) => Number.isFinite(value) && value >= 0)) return null;
    return { equivalentSteps, saleRate: tariff.salePrice, clientPrice, workshopCost, baseClientPrice, baseWorkshopCost, clientAdjustment: clientPrice - baseClientPrice, workshopAdjustment: workshopCost - baseWorkshopCost, grossProfit: clientPrice - workshopCost };
  }, [
    clientOverride,
    deliveryRequired,
    installationRequired,
    lines,
    material,
    materialTariffs,
    pickup,
    platforms,
    regularSteps,
    workshopOverride,
  ]);

  function updatePlatform(index: number, value: number) {
    setPlatforms((items) =>
      items.map((item, position) => (position === index ? value : item)),
    );
  }
  async function save() {
    if (
      !calculation ||
      !Number.isInteger(Number(targetOrderId)) ||
      Number(targetOrderId) <= 0
    )
      return setMessage("Укажите корректный ID заказа и заполните расчёт.");
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${targetOrderId}/calculation`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          material,
          regularSteps: Number(regularSteps),
          platformEquivalents: platforms,
          ...(clientOverride === ""
            ? {}
            : { clientPrice: Number(clientOverride) }),
          ...(isDirector && workshopOverride !== ""
            ? { workshopCost: Number(workshopOverride) }
            : {}),
          installationRequired,
          deliveryRequired,
          otherCity,
          pickup,
          lines,
        }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(payload.error ?? "Не удалось сохранить расчёт");
      setMessage(
        "Расчёт сохранён в заказе. Суммы зафиксированы снимком и не изменятся при обновлении тарифов.",
      );
      setSavedOrderId(Number(targetOrderId));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Не удалось сохранить расчёт",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="text-sm text-slate-300">
          Материал
          <select
            value={material}
            onChange={(event) => setMaterial(event.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-white"
          >
            {materialTariffs.map((value) => (
              <option key={value.code}>{value.uiName}</option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-300">
          Обычные ступени
          <input
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            value={regularSteps}
            onChange={(event) => setRegularSteps(event.target.value)}
            className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-white"
          />
        </label>
      </div>
      <section className="rounded-xl border border-slate-700 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-white">Площадки</h2>
            <p className="text-sm text-slate-400">
              Для каждой площадки выберите эквивалент 2 или 3 ступени.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setPlatforms((items) => [...items, 2])}
            className="min-h-11 rounded-xl bg-blue-600 px-4 text-white"
          >
            Добавить
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {platforms.map((value, index) => (
            <div key={index} className="flex items-center gap-3">
              <label className="min-w-0 flex-1 text-sm text-slate-300">
                Площадка {index + 1}
                <select
                  value={value}
                  onChange={(event) =>
                    updatePlatform(index, Number(event.target.value))
                  }
                  className="mt-1 min-h-11 w-full rounded-lg bg-slate-900 px-3 text-white"
                >
                  <option value={2}>2 ступени</option>
                  <option value={3}>3 ступени</option>
                </select>
              </label>
              <button
                type="button"
                aria-label={`Удалить площадку ${index + 1}`}
                onClick={() =>
                  setPlatforms((items) =>
                    items.filter((_, position) => position !== index),
                  )
                }
                className="mt-6 min-h-11 rounded-lg bg-red-900 px-4 text-white"
              >
                Удалить
              </button>
            </div>
          ))}
          {!platforms.length && (
            <p className="text-sm text-slate-500">Площадок нет.</p>
          )}
        </div>
      </section>
      <section className="space-y-4 rounded-xl border border-slate-700 p-4">
        <div>
          <h2 className="font-semibold text-white">Монтаж и доставка</h2>
          <p className="text-sm text-slate-400">
            Отключённые услуги не включаются в итог заказа.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Check
            label="Требуется монтаж"
            checked={installationRequired}
            onChange={setInstallationRequired}
          />
          <Check
            label="Требуется доставка"
            checked={deliveryRequired}
            onChange={setDeliveryRequired}
          />
          <Check
            label="Другой город"
            checked={otherCity}
            onChange={setOtherCity}
          />
          <Check
            label="Самовывоз"
            checked={pickup}
            onChange={(value) => {
              setPickup(value);
              if (value) setDeliveryRequired(false);
            }}
          />
        </div>
      </section>
      <section className="space-y-4 rounded-xl border border-slate-700 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-white">Дополнительные позиции</h2>
            <p className="text-sm text-slate-400">
              Материалы, ограждения, стекло, работы, скидки и наценки.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              const tariff = positionTariffs[0];
              if (tariff) setLines((items) => [...items, { code: tariff.code, kind: tariff.kind, name: tariff.uiName, quantity: tariff.defaultQuantity || 1, unit: tariff.unit, unitCost: tariff.internalPrice ?? 0, unitSale: tariff.salePrice, enabled: true }]);
            }}
            className="min-h-11 rounded-xl bg-blue-600 px-4 text-white"
          >
            Добавить позицию
          </button>
        </div>
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-xl bg-slate-900/70 p-3 md:grid-cols-8"
          >
            <select aria-label={`Название позиции ${index + 1}`} value={line.code} onChange={(event) => {
              const tariff = positionTariffs.find((item) => item.code === event.target.value);
              if (tariff) setLines((items) => items.map((item, position) => position === index ? { ...item, code: tariff.code, kind: tariff.kind, name: tariff.uiName, unit: tariff.unit, unitCost: tariff.internalPrice ?? 0, unitSale: tariff.salePrice, quantity: tariff.defaultQuantity || item.quantity } : item));
            }} className="input md:col-span-2">{positionTariffs.map((tariff) => <option key={tariff.code} value={tariff.code}>{tariff.uiName}</option>)}</select>
            <input
              aria-label={`Количество позиции ${index + 1}`}
              type="number"
              min="0"
              step="0.001"
              value={line.quantity}
              onChange={(event) =>
                setLines((items) =>
                  items.map((item, position) =>
                    position === index
                      ? { ...item, quantity: Number(event.target.value) }
                      : item,
                  ),
                )
              }
              className="input"
            />
            <div className="flex min-h-11 items-center rounded-lg border border-slate-700 px-3 text-sm text-slate-300" aria-label={`Единица позиции ${index + 1}`}>{line.unit}</div>
            {canSeeInternal && (
              <input
                aria-label={`Себестоимость позиции ${index + 1}`}
                type="number"
                min="0"
                value={line.unitCost}
                disabled={!isDirector || !positionTariffs.find((item) => item.code === line.code)?.manualPriceAllowed}
                onChange={(event) =>
                  setLines((items) =>
                    items.map((item, position) =>
                      position === index
                        ? { ...item, unitCost: Number(event.target.value) }
                        : item,
                    ),
                  )
                }
                className="input"
              />
            )}
            <input
              aria-label={`Цена позиции ${index + 1}`}
              type="number"
              min="0"
              disabled={!positionTariffs.find((item) => item.code === line.code)?.manualPriceAllowed}
              value={line.unitSale}
              onChange={(event) =>
                setLines((items) =>
                  items.map((item, position) =>
                    position === index
                      ? { ...item, unitSale: Number(event.target.value) }
                      : item,
                  ),
                )
              }
              className="input"
            />
            <input aria-label={`Комментарий позиции ${index + 1}`} value={line.comment ?? ""} onChange={(event) => setLines((items) => items.map((item, position) => position === index ? { ...item, comment: event.target.value } : item))} placeholder="Комментарий" className="input md:col-span-2" />
            <div className="flex min-h-11 items-center text-sm font-semibold text-white">Итого: {money(line.enabled === false ? 0 : line.quantity * line.unitSale)}</div>
            <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={line.enabled !== false} onChange={(event) => setLines((items) => items.map((item, position) => position === index ? { ...item, enabled: event.target.checked } : item))}/>Включена</label>
            <button
              type="button"
              onClick={() =>
                setLines((items) =>
                  items.filter((_, position) => position !== index),
                )
              }
              className="min-h-11 rounded-lg bg-red-900 px-3 text-white"
            >
              Удалить
            </button>
          </div>
        ))}
        {!lines.length && (
          <p className="text-sm text-slate-500">Дополнительных позиций нет.</p>
        )}
      </section>
      {calculation ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Result
              title="Эквивалентные ступени"
              value={String(calculation.equivalentSteps)}
            />
            <Result
              title="Стоимость одной ступени"
              value={money(calculation.saleRate)}
            />
            {canSeeInternal && (
              <Result
                title="Стоимость работ цеха"
                value={money(calculation.workshopCost)}
              />
            )}
            <Result
              title="Продажная стоимость"
              value={money(calculation.clientPrice)}
            />
            <Result
              title="Скидка"
              value={money(Math.max(0, calculation.baseClientPrice - calculation.clientPrice))}
            />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm text-slate-300">
              Итоговая цена клиенту
              <input
                type="number"
                inputMode="numeric"
                min="0"
                value={clientOverride}
                placeholder={String(calculation.baseClientPrice)}
                onChange={(event) => setClientOverride(event.target.value)}
                className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-white"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Корректировка: {money(calculation.clientAdjustment)}
              </span>
            </label>
            {isDirector && (
              <label className="text-sm text-slate-300">
                Итоговая стоимость цеха
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  value={workshopOverride}
                  placeholder={String(calculation.baseWorkshopCost)}
                  onChange={(event) => setWorkshopOverride(event.target.value)}
                  className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-white"
                />
                <span className="mt-1 block text-xs text-slate-500">
                  Корректировка: {money(calculation.workshopAdjustment)}
                </span>
              </label>
            )}
          </div>
          {isDirector && (
            <div className="rounded-2xl bg-blue-950/40 p-5">
              <p className="text-slate-300">Разница продажи и внутренних затрат</p>
              <p className="mt-1 text-3xl font-bold text-blue-300">
                {money(calculation.grossProfit)}
              </p>
            </div>
          )}
        </>
      ) : (
        <p role="alert" className="rounded-xl bg-red-950/40 p-4 text-red-300">
          Проверьте количество ступеней и суммы.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="text-sm text-slate-300">
          ID заказа
          <input
            type="number"
            inputMode="numeric"
            min="1"
            value={targetOrderId}
            disabled={!!orderId}
            onChange={(event) => setTargetOrderId(event.target.value)}
            placeholder="Например, 125"
            className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-white disabled:opacity-60"
          />
        </label>
        <button
          type="button"
          disabled={saving || !calculation}
          onClick={() => void save()}
          className="min-h-12 self-end rounded-xl bg-green-600 px-6 font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Сохранение…" : "Сохранить в заказ"}
        </button>
      </div>
      {message && (
        <p
          role="status"
          className="rounded-xl border border-slate-700 p-4 text-slate-200"
        >
          {message}
        </p>
      )}
      {savedOrderId && <Link href={`/orders/${savedOrderId}/offer`} className="inline-flex min-h-11 items-center rounded-xl bg-blue-600 px-5 font-semibold text-white">Сформировать КП</Link>}
    </div>
  );
}

function Result({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-900 p-4">
      <p className="text-sm text-slate-400">{title}</p>
      <p className="mt-2 break-words text-xl font-bold text-white">{value}</p>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 rounded-xl bg-slate-900 px-3 text-sm text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="size-5"
      />
      {label}
    </label>
  );
}
