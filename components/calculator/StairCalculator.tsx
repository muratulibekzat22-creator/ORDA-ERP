"use client";

import { useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  calculateStair,
  STAIR_RATES,
  type CalculationLineInput,
  type StairMaterial,
} from "@/lib/calculator/stair-calculation";

const money = (value: number) => `${value.toLocaleString("ru-RU")} ₸`;

export default function StairCalculator({ orderId }: { orderId?: number }) {
  const { data: session } = useSession();
  const [targetOrderId, setTargetOrderId] = useState(
    orderId ? String(orderId) : "",
  );
  const [material, setMaterial] = useState<StairMaterial>("Карагач");
  const [regularSteps, setRegularSteps] = useState("18");
  const [platforms, setPlatforms] = useState<number[]>([2]);
  const [clientOverride, setClientOverride] = useState("");
  const [workshopOverride, setWorkshopOverride] = useState("");
  const [installationRequired, setInstallationRequired] = useState(true);
  const [deliveryRequired, setDeliveryRequired] = useState(true);
  const [otherCity, setOtherCity] = useState(false);
  const [pickup, setPickup] = useState(false);
  const [lines, setLines] = useState<CalculationLineInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const isDirector = session?.user.role === "DIRECTOR";
  const canSeeInternal = isDirector || session?.user.role === "ACCOUNTANT";
  const calculation = useMemo(() => {
    try {
      return calculateStair({
        material,
        regularSteps: Number(regularSteps),
        platformEquivalents: platforms,
        ...(clientOverride === ""
          ? {}
          : { clientPrice: Number(clientOverride) }),
        ...(!isDirector || workshopOverride === ""
          ? {}
          : { workshopCost: Number(workshopOverride) }),
        installationRequired,
        deliveryRequired,
        otherCity,
        pickup,
        lines,
      });
    } catch {
      return null;
    }
  }, [
    clientOverride,
    deliveryRequired,
    installationRequired,
    isDirector,
    lines,
    material,
    otherCity,
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
            onChange={(event) =>
              setMaterial(event.target.value as StairMaterial)
            }
            className="mt-1 min-h-12 w-full rounded-xl bg-slate-900 p-3 text-white"
          >
            {Object.keys(STAIR_RATES).map((value) => (
              <option key={value}>{value}</option>
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
            onClick={() =>
              setLines((items) => [
                ...items,
                {
                  kind: "OTHER_WORK",
                  name: "Новая позиция",
                  quantity: 1,
                  unit: "шт.",
                  unitCost: 0,
                  unitSale: 0,
                  enabled: true,
                },
              ])
            }
            className="min-h-11 rounded-xl bg-blue-600 px-4 text-white"
          >
            Добавить позицию
          </button>
        </div>
        {lines.map((line, index) => (
          <div
            key={index}
            className="grid gap-2 rounded-xl bg-slate-900/70 p-3 md:grid-cols-6"
          >
            <input
              aria-label={`Название позиции ${index + 1}`}
              value={line.name}
              onChange={(event) =>
                setLines((items) =>
                  items.map((item, position) =>
                    position === index
                      ? { ...item, name: event.target.value }
                      : item,
                  ),
                )
              }
              className="input md:col-span-2"
            />
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
            {canSeeInternal && (
              <input
                aria-label={`Себестоимость позиции ${index + 1}`}
                type="number"
                min="0"
                value={line.unitCost}
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
          {canSeeInternal && (
            <div className="rounded-2xl bg-blue-950/40 p-5">
              <p className="text-slate-300">Валовая разница ALTYN SAPA</p>
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
