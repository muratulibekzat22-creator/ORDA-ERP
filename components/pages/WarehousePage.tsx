"use client";

import { Role } from "@prisma/client";
import {
  AlertTriangle,
  Archive,
  Boxes,
  CircleDollarSign,
  Pencil,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import PurchaseBatchesPanel from "@/components/warehouse/PurchaseBatchesPanel";
import BrassProcurementsPanel from "@/components/warehouse/BrassProcurementsPanel";
import WarehouseRetailPanel from "@/components/warehouse/WarehouseRetailPanel";

type Material = {
  id: number;
  name: string;
  model?: string | null;
  description?: string | null;
  category: string;
  unit: string;
  minimumStock: number;
  stock: number;
  reserved: number;
  available: number | null;
  purchasePrice?: string | null;
  averageCost?: string;
  sellingPrice?: string | null;
  code?: string | null;
  color?: string | null;
  finish?: string | null;
  dimensions?: string | null;
  variantGroup?: string | null;
  quantityKnown?: boolean;
  quantityPrecision?: number;
  availabilityLabel?: string;
  photoUrl?: string | null;
  balances?: Array<{ stock: string; reserved: string; location: { id: number; name: string; address: string } }>;
  supplier: string | null;
  active: boolean;
  alerts: string[];
};
type Order = { id: number; number: string; client: { name: string } };
type WarehouseLocationOption = { id: number; name: string; isDefault: boolean };
type Movement = {
  id: number;
  type: string;
  quantity: number;
  price?: string;
  amount?: string;
  stockDelta: number;
  reserveDelta: number;
  stockAfter: number | null;
  reservedAfter: number | null;
  comment: string | null;
  operationAt: string;
  material: { name: string; unit: string };
  order: { id: number; number: string; client: { name: string } } | null;
  employee: { name: string } | null;
  location?: { id: number; name: string } | null;
  fromLocation?: { id: number; name: string } | null;
  toLocation?: { id: number; name: string } | null;
  document?: { id: number; number: string } | null;
};
type Reservation = {
  id: number;
  quantity: number;
  consumed: number;
  status: string;
  expiresAt: string | null;
  updatedAt: string;
  material: { id: number; name: string; unit: string };
  order: { id: number; number: string; client: { name: string } };
  createdBy: { name: string } | null;
};
type Data = {
  materials: Material[];
  orders: Order[];
  movements: Movement[];
  reservations: Reservation[];
  pagination: { page: number; pages: number; total: number };
  stats: {
    materials: number;
    lowStock: number;
    stockValue?: number;
    reserved: number;
    available: number;
    noPrice?: number;
    suppliers: string[];
  };
};
const empty: Data = {
  materials: [],
  orders: [],
  movements: [],
  reservations: [],
  pagination: { page: 1, pages: 0, total: 0 },
  stats: {
    materials: 0,
    lowStock: 0,
    stockValue: 0,
    reserved: 0,
    available: 0,
    noPrice: 0,
    suppliers: [],
  },
};
const materialBlank = {
  name: "",
  model: "",
  description: "",
  category: "",
  unit: "шт",
  minimumStock: "0",
  purchasePrice: "",
  sellingPrice: "",
  supplier: "",
  initialStock: "0",
  active: true,
};
const currentLocalDateTime = () => {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
};
const operationBlank = {
  type: "incoming",
  materialId: "",
  locationId: "",
  orderId: "",
  quantity: "",
  price: "",
  supplier: "",
  comment: "",
  operationAt: currentLocalDateTime(),
  expiresAt: "",
};
const labels: Record<string, string> = {
  incoming: "Приход",
  outgoing: "Расход",
  sale: "Продажа со склада",
  writeoff: "Списание",
  supplier_return: "Возврат поставщику",
  workshop_issue: "Передача в цех",
  adjustment: "Корректировка",
  return: "Возврат",
  reserve: "Резерв",
  release: "Снятие резерва",
  consume: "Списание резерва",
};

export default function WarehousePage() {
  const { data: session } = useSession();
  const role = (session?.user.accountRole || session?.user.role) as Role | undefined;
  const [data, setData] = useState(empty),
    [loading, setLoading] = useState(true),
    [saving, setSaving] = useState(false),
    [error, setError] = useState(""),
    [tab, setTab] = useState("materials");
  const [operationLocations, setOperationLocations] = useState<WarehouseLocationOption[]>([]);
  const [material, setMaterial] = useState(materialBlank),
    [editing, setEditing] = useState<Material | null>(null),
    [operation, setOperation] = useState(operationBlank);
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [color, setColor] = useState(""),
    [location, setLocation] = useState(""),
    [supplier, setSupplier] = useState(""),
    [lowOnly, setLowOnly] = useState(false),
    [movementType, setMovementType] = useState(""),
    [orderFilter, setOrderFilter] = useState(""),
    [page, setPage] = useState(1);
  const warehouseOperator = Boolean(role && role !== Role.PARTNER);
  const canCreateMaterial = warehouseOperator,
    canEdit = warehouseOperator,
    canDelete = warehouseOperator,
    canSeeCost = warehouseOperator;
  const canUseBrass = warehouseOperator;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (movementType) params.set("type", movementType);
    if (orderFilter) params.set("orderId", orderFilter);
    try {
      const response = await fetch(`/api/warehouse?${params}`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ??
            "Не удалось загрузить склад",
        );
      setData((await response.json()) as Data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка склада");
    } finally {
      setLoading(false);
    }
  }, [movementType, orderFilter, page]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    let active = true;
    void fetch("/api/warehouse/locations", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return response.json() as Promise<{ locations: WarehouseLocationOption[] }>;
      })
      .then(({ locations }) => {
        if (!active) return;
        setOperationLocations(locations);
        setOperation((current) => current.locationId ? current : { ...current, locationId: String(locations.find((item) => item.isDefault)?.id ?? locations[0]?.id ?? "") });
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);
  async function mutate(
    method: "POST" | "PATCH" | "DELETE",
    body?: unknown,
    url = "/api/warehouse",
  ) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok)
        throw new Error(
          ((await response.json()) as { error?: string }).error ??
            "Операция не выполнена",
        );
      await load();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Операция не выполнена",
      );
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function saveMaterial(event: FormEvent) {
    event.preventDefault();
    const payload = {
      name: material.name,
      model: material.model,
      description: material.description,
      category: material.category,
      unit: material.unit,
      minimumStock: material.minimumStock,
      purchasePrice: material.purchasePrice,
      sellingPrice: material.sellingPrice,
      supplier: material.supplier,
    };
    const ok = editing
      ? await mutate("PATCH", {
          id: editing.id,
          ...payload,
          active: material.active,
        })
      : await mutate("POST", {
          action: "material",
          ...payload,
          initialStock: material.initialStock,
        });
    if (ok) {
      setEditing(null);
      setMaterial(materialBlank);
    }
  }
  async function saveOperation(event: FormEvent) {
    event.preventDefault();
    const ok = await mutate("POST", {
      action: "operation",
      ...operation,
      orderId: operation.orderId || undefined,
      price: operation.price || undefined,
      supplier: operation.supplier || undefined,
      expiresAt: operation.expiresAt || undefined,
    });
    if (ok) setOperation({ ...operationBlank, type: operation.type, locationId: operation.locationId });
  }
  function edit(item: Material) {
    setEditing(item);
    setMaterial({
      name: item.name,
      model: item.model ?? "",
      description: item.description ?? "",
      category: item.category,
      unit: item.unit,
      minimumStock: String(item.minimumStock),
      purchasePrice: item.purchasePrice ?? "",
      sellingPrice: item.sellingPrice ?? "",
      supplier: item.supplier ?? "",
      initialStock: "0",
      active: item.active,
    });
    setTab("materials");
  }
  const filtered = useMemo(
    () =>
      data.materials.filter(
        (item) =>
          (!search ||
            [item.name, item.code ?? "", item.model ?? "", item.description ?? "", item.category, item.color ?? "", item.supplier ?? ""].some((value) =>
              value
                .toLocaleLowerCase("ru")
                .includes(search.toLocaleLowerCase("ru")),
            )) &&
          (!category || item.category === category) &&
          (!color || item.color === color) &&
          (!location || item.balances?.some((balance) => balance.location.name === location)) &&
          (!supplier || item.supplier === supplier) &&
          (!lowOnly || item.stock <= item.minimumStock),
      ),
    [data.materials, search, category, color, location, supplier, lowOnly],
  );
  const operationOptions = [
    "incoming",
    "sale",
    "writeoff",
    "supplier_return",
    "workshop_issue",
    "adjustment",
    "return",
    "reserve",
    "release",
    "consume",
  ];
  return (
    <section className="min-h-screen flex-1 overflow-auto bg-[#0b1120] p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Склад</h1>
          <p className="mt-2 text-slate-400">
            Товары, закупки, точная себестоимость, продажи и передача в цех
          </p>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="my-5 flex flex-col gap-3 rounded-xl border border-red-800 bg-red-950/40 p-4 text-red-300 sm:flex-row sm:items-center sm:justify-between"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-lg bg-red-900/70 px-4 py-2 text-sm text-white"
          >
            Повторить
          </button>
        </div>
      )}
      <div className="my-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {(
          [
            [Boxes, "Материалов", data.stats.materials],
            ...(canSeeCost
              ? [
                  [
                    CircleDollarSign,
                    "Стоимость",
                    `${(data.stats.stockValue ?? 0).toLocaleString()} ₸`,
                  ] as [LucideIcon, string, string],
                ]
              : []),
            [Archive, "Зарезервировано", data.stats.reserved],
            [Boxes, "Доступно", data.stats.available],
            [AlertTriangle, "Низкий остаток", data.stats.lowStock],
          ] satisfies Array<[LucideIcon, string, string | number]>
        ).map(([Icon, title, value]) => (
          <div
            key={title}
            className="rounded-2xl border border-slate-700 bg-[#101827] p-5"
          >
            <Icon className="mb-3 text-blue-400" />
            <p className="text-sm text-slate-400">{title}</p>
            <p className="mt-1 text-2xl font-bold text-white">{value}</p>
          </div>
        ))}
      </div>
      <div className="mb-5 flex gap-2 overflow-x-auto pb-2">
        {[
          ["materials", "Материалы"],
          ...(canUseBrass ? [["brass", "Латунь под заказы"]] : []),
          ...(canSeeCost ? [["purchases", "Закупки"]] : []),
          ...(warehouseOperator ? [["operations", "Операции"]] : []),
          ["reservations", "Резервы"],
          ["history", "История"],
        ].map(([id, title]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`whitespace-nowrap rounded-xl px-4 py-2 ${tab === id ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}
          >
            {title}
          </button>
        ))}
      </div>
      {tab === "brass" ? (
        <BrassProcurementsPanel
          canOperate={canUseBrass}
          canPay={canUseBrass}
          canAddSupplier={canUseBrass}
          readOnly={false}
        />
      ) : loading ? (
        <p className="rounded-2xl bg-[#101827] p-8 text-slate-400">
          Загрузка склада…
        </p>
      ) : (
        <>
          {tab === "materials" && (
            <div className="space-y-5">
              <WarehouseRetailPanel materials={data.materials} role={role} onRefresh={load} />
              {(canCreateMaterial || editing) && (
                <form
                  onSubmit={saveMaterial}
                  className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-3"
                >
                  {(
                    [
                      "name",
                      "model",
                      "description",
                      "category",
                      "unit",
                      "minimumStock",
                      "purchasePrice",
                      "sellingPrice",
                      "supplier",
                    ] as const
                  ).map((field) => (
                    <input
                      key={field}
                      required={["name", "category", "unit"].includes(field)}
                      type={
                        ["minimumStock", "purchasePrice", "sellingPrice"].includes(field)
                          ? "number"
                          : "text"
                      }
                      min="0"
                      step="any"
                      value={material[field]}
                      onChange={(event) =>
                        setMaterial({
                          ...material,
                          [field]: event.target.value,
                        })
                      }
                      placeholder={
                        {
                          name: "Название",
                          model: "Модель / артикул",
                          description: "Состав комплекта, например: пара = 2 шт.",
                          category: "Категория",
                          unit: "Единица",
                          minimumStock: "Минимальный остаток",
                          purchasePrice: "Закупочная цена",
                          sellingPrice: "Продажная цена",
                          supplier: "Поставщик",
                        }[field]
                      }
                      className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"
                    />
                  ))}
                  {!editing && (
                    <input
                      type="number"
                      min="0"
                      step="any"
                      value={material.initialStock}
                      onChange={(event) =>
                        setMaterial({
                          ...material,
                          initialStock: event.target.value,
                        })
                      }
                      placeholder="Начальный остаток"
                      className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-white"
                    />
                  )}
                  {editing && (
                    <label className="flex items-center gap-2 text-slate-300">
                      <input
                        type="checkbox"
                        checked={material.active}
                        onChange={(event) =>
                          setMaterial({
                            ...material,
                            active: event.target.checked,
                          })
                        }
                      />
                      Активен
                    </label>
                  )}
                  <button
                    disabled={saving}
                    className="rounded-xl bg-blue-600 p-3 font-semibold text-white disabled:opacity-50"
                  >
                    {saving
                      ? "Сохранение…"
                      : editing
                        ? "Сохранить"
                        : "Добавить материал"}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setMaterial(materialBlank);
                      }}
                      className="rounded-xl bg-slate-700 p-3 text-white"
                    >
                      Отмена
                    </button>
                  )}
                </form>
              )}
              <div className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-4 md:grid-cols-3 xl:grid-cols-6">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск"
                  className="rounded-xl bg-slate-900 p-3 text-white"
                />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="rounded-xl bg-slate-900 p-3 text-white"
                >
                  <option value="">Все категории</option>
                  {[...new Set(data.materials.map((x) => x.category))].map(
                    (x) => (
                      <option key={x}>{x}</option>
                    ),
                  )}
                </select>
                <select value={color} onChange={(event) => setColor(event.target.value)} className="rounded-xl bg-slate-900 p-3 text-white">
                  <option value="">Все цвета</option>
                  {[...new Set(data.materials.map((item) => item.color).filter((value): value is string => Boolean(value)))].map((value) => <option key={value}>{value}</option>)}
                </select>
                <select value={location} onChange={(event) => setLocation(event.target.value)} className="rounded-xl bg-slate-900 p-3 text-white">
                  <option value="">Все места хранения</option>
                  {[...new Set(data.materials.flatMap((item) => item.balances?.map((balance) => balance.location.name) ?? []))].map((value) => <option key={value}>{value}</option>)}
                </select>
                <select
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                  className="rounded-xl bg-slate-900 p-3 text-white"
                >
                  <option value="">Все поставщики</option>
                  {data.stats.suppliers.map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
                <label className="flex items-center gap-2 text-slate-300">
                  <input
                    type="checkbox"
                    checked={lowOnly}
                    onChange={(e) => setLowOnly(e.target.checked)}
                  />
                  Только низкий остаток
                </label>
              </div>
              {!filtered.length && (
                <p className="rounded-2xl border border-dashed border-slate-700 bg-[#101827] p-8 text-center text-slate-400 md:hidden">
                  Материалы не найдены
                </p>
              )}
              {filtered.length > 0 && (
                <div className="grid gap-3 md:hidden">
                  {filtered.map((item) => (
                    <article
                      key={item.id}
                      className="rounded-2xl border border-slate-700 bg-[#101827] p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h2 className="font-semibold text-white">
                            {item.name}
                          </h2>
                          <p className="mt-1 text-xs text-slate-400">
                            {item.category} · {item.unit}
                          </p>
                        </div>
                        <StockStatus item={item} />
                      </div>
                      <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                        <StockValue label="В наличии" value={item.quantityKnown === false ? null : item.stock} />
                        <StockValue label="Резерв" value={item.quantityKnown === false ? null : item.reserved} />
                        <StockValue label="Доступно" value={item.available} />
                      </dl>
                      <p className="mt-3 text-sm font-semibold text-emerald-300">{item.sellingPrice == null ? "Цена не задана" : `${Number(item.sellingPrice).toLocaleString("ru-RU")} ₸`}</p>
                      {(canEdit || canDelete) && (
                        <div className="mt-4 flex gap-2">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => edit(item)}
                              className="min-h-10 flex-1 rounded-lg bg-slate-700 px-3 text-sm text-white"
                            >
                              Изменить
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() =>
                                window.confirm("Удалить материал?") &&
                                void mutate(
                                  "DELETE",
                                  undefined,
                                  `/api/warehouse?id=${item.id}`,
                                )
                              }
                              className="min-h-10 rounded-lg bg-red-900 px-3 text-sm text-white"
                            >
                              Удалить
                            </button>
                          )}
                        </div>
                      )}
                    </article>
                  ))}
                </div>
              )}
              <div className="hidden overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827] md:block">
                {!filtered.length ? (
                  <p className="p-6 text-slate-400">Материалы не найдены</p>
                ) : (
                  <table className="w-full min-w-[900px] text-left">
                    <thead className="bg-slate-900 text-slate-400">
                      <tr>
                        {[
                          "Материал",
                          "Категория",
                          "Физический",
                          "Резерв",
                          "Доступно",
                          ...(canSeeCost ? ["Себестоимость"] : []),
                          "Цена продажи",
                          "Поставщик",
                          "Статус",
                          "",
                        ].map((x) => (
                          <th key={x} className="p-4">
                            {x}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((item) => (
                        <tr
                          key={item.id}
                          className="border-t border-slate-800 text-slate-300"
                        >
                          <td className="p-4 font-semibold text-white">
                            {item.name}
                            <span className="block text-xs text-slate-500">
                              {item.unit}
                            {item.model ? ` · ${item.model}` : ""}
                            </span>
                          </td>
                          <td>{item.category}</td>
                          <td>{item.stock}</td>
                          <td>{item.reserved}</td>
                          <td
                            className={
                              item.available !== null && item.available <= 0
                                ? "text-red-400"
                                : "text-green-400"
                            }
                          >
                            {item.available}
                          </td>
                          {canSeeCost && (
                            <td>
                              {item.purchasePrice == null ? "Не задана" : `${Number(item.averageCost ?? item.purchasePrice).toLocaleString()} ₸`}
                            </td>
                          )}
                          <td>{item.sellingPrice == null ? "Не задана" : `${Number(item.sellingPrice).toLocaleString()} ₸`}</td>
                          <td>{item.supplier || "—"}</td>
                          <td>
                            <StockStatus item={item} />
                          </td>
                          <td>
                            <div className="flex gap-2">
                              {canEdit && (
                                <button
                                  onClick={() => edit(item)}
                                  className="rounded-lg bg-slate-700 p-2"
                                >
                                  <Pencil size={16} />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  disabled={saving}
                                  onClick={() =>
                                    window.confirm("Удалить материал?") &&
                                    void mutate(
                                      "DELETE",
                                      undefined,
                                      `/api/warehouse?id=${item.id}`,
                                    )
                                  }
                                  className="rounded-lg bg-red-900 p-2"
                                >
                                  <Trash2 size={16} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
          {tab === "purchases" && (
            <PurchaseBatchesPanel
              canManage={warehouseOperator}
              materials={data.materials.map((item) => ({
                id: item.id,
                name: item.name,
                unit: item.unit,
              }))}
            />
          )}
          {tab === "operations" && (
            <form
              onSubmit={saveOperation}
              className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-6 md:grid-cols-2"
            >
              <h2 className="text-xl font-bold text-white md:col-span-2">
                Новая складская операция
              </h2>
              <select
                value={operation.type}
                onChange={(e) =>
                  setOperation({ ...operation, type: e.target.value })
                }
                className="rounded-xl bg-slate-900 p-3 text-white"
              >
                {operationOptions.map((x) => (
                  <option key={x} value={x}>
                    {labels[x]}
                  </option>
                ))}
              </select>
              <select
                required
                value={operation.locationId}
                onChange={(e) => setOperation({ ...operation, locationId: e.target.value })}
                className="rounded-xl bg-slate-900 p-3 text-white"
              >
                <option value="">Место хранения</option>
                {operationLocations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
              <select
                required
                value={operation.materialId}
                onChange={(e) =>
                  setOperation({ ...operation, materialId: e.target.value })
                }
                className="rounded-xl bg-slate-900 p-3 text-white"
              >
                <option value="">Материал</option>
                {data.materials
                  .filter((x) => x.active)
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · доступно {x.available}
                    </option>
                  ))}
              </select>
              {["reserve", "release", "consume", "workshop_issue", "sale"].includes(operation.type) ||
              operation.type === "outgoing" ? (
                <select
                  required={["reserve", "release", "consume", "workshop_issue"].includes(
                    operation.type,
                  )}
                  value={operation.orderId}
                  onChange={(e) =>
                    setOperation({ ...operation, orderId: e.target.value })
                  }
                  className="rounded-xl bg-slate-900 p-3 text-white"
                >
                  <option value="">Заказ</option>
                  {data.orders.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.number} — {x.client.name}
                    </option>
                  ))}
                </select>
              ) : null}
              <input
                required
                type="number"
                min={operation.type === "adjustment" ? "0" : "0.000001"}
                step="any"
                value={operation.quantity}
                onChange={(e) =>
                  setOperation({ ...operation, quantity: e.target.value })
                }
                placeholder={
                  operation.type === "adjustment"
                    ? "Новый физический остаток"
                    : "Количество"
                }
                className="rounded-xl bg-slate-900 p-3 text-white"
              />
              {canSeeCost && (
                <>
                  <input
                    type="number"
                    min="0"
                    step="any"
                    value={operation.price}
                    onChange={(e) =>
                      setOperation({ ...operation, price: e.target.value })
                    }
                    placeholder={operation.type === "sale" ? "Цена продажи" : "Фактическая цена / себестоимость"}
                    className="rounded-xl bg-slate-900 p-3 text-white"
                  />
                  <input
                    value={operation.supplier}
                    onChange={(e) =>
                      setOperation({ ...operation, supplier: e.target.value })
                    }
                    placeholder="Поставщик"
                    className="rounded-xl bg-slate-900 p-3 text-white"
                  />
                </>
              )}
              <input
                type="datetime-local"
                value={operation.operationAt}
                onChange={(e) =>
                  setOperation({ ...operation, operationAt: e.target.value })
                }
                className="rounded-xl bg-slate-900 p-3 text-white"
              />
              {operation.type === "reserve" && (
                <input
                  type="datetime-local"
                  value={operation.expiresAt}
                  onChange={(e) =>
                    setOperation({ ...operation, expiresAt: e.target.value })
                  }
                  className="rounded-xl bg-slate-900 p-3 text-white"
                />
              )}
              <input
                required={["adjustment", "writeoff", "supplier_return"].includes(operation.type)}
                value={operation.comment}
                maxLength={1000}
                onChange={(e) =>
                  setOperation({ ...operation, comment: e.target.value })
                }
                placeholder={["adjustment", "writeoff", "supplier_return"].includes(operation.type) ? "Причина (обязательно)" : "Комментарий"}
                className="rounded-xl bg-slate-900 p-3 text-white"
              />
              <button
                disabled={saving}
                className="rounded-xl bg-blue-600 p-3 font-semibold text-white disabled:opacity-50"
              >
                {saving ? "Сохранение…" : "Выполнить"}
              </button>
            </form>
          )}
          {tab === "reservations" && (
            <div className="overflow-x-auto rounded-2xl border border-slate-700 bg-[#101827]">
              {!data.reservations.length ? (
                <p className="p-6 text-slate-400">Резервов нет</p>
              ) : (
                <table className="w-full min-w-[800px] text-left">
                  <thead className="bg-slate-900 text-slate-400">
                    <tr>
                      <th className="p-4">Заказ</th>
                      <th>Материал</th>
                      <th>Зарезервировано</th>
                      <th>Списано</th>
                      <th>Статус</th>
                      <th>Срок</th>
                      <th>Сотрудник</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.reservations.map((x) => (
                      <tr
                        key={x.id}
                        className="border-t border-slate-800 text-slate-300"
                      >
                        <td className="p-4">
                          <Link
                            href={`/orders/${x.order.id}`}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            Заказ №{x.order.number}
                          </Link>
                          <span className="block text-xs">
                            {x.order.client.name}
                          </span>
                        </td>
                        <td>{x.material.name}</td>
                        <td>
                          {x.quantity} {x.material.unit}
                        </td>
                        <td>{x.consumed}</td>
                        <td>{x.status}</td>
                        <td
                          className={
                            x.expiresAt && new Date(x.expiresAt) < new Date()
                              ? "text-red-400"
                              : ""
                          }
                        >
                          {x.expiresAt
                            ? new Date(x.expiresAt).toLocaleString("ru-RU")
                            : "—"}
                        </td>
                        <td>{x.createdBy?.name ?? "Система"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
          {tab === "history" && (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-3">
                <select
                  value={movementType}
                  onChange={(e) => {
                    setMovementType(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl bg-slate-900 p-3 text-white"
                >
                  <option value="">Все операции</option>
                  {Object.entries(labels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={orderFilter}
                  onChange={(e) => {
                    setOrderFilter(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-xl bg-slate-900 p-3 text-white"
                >
                  <option value="">Все заказы</option>
                  {data.orders.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.number}
                    </option>
                  ))}
                </select>
              </div>
              <div className="rounded-2xl border border-slate-700 bg-[#101827]">
                {!data.movements.length ? (
                  <p className="p-6 text-slate-400">Движений нет</p>
                ) : (
                  data.movements.map((x) => (
                    <div
                      key={x.id}
                      className="grid gap-2 border-b border-slate-800 p-4 text-slate-300 md:grid-cols-6"
                    >
                      <b className="text-white">{labels[x.type] ?? x.type}</b>
                      <span>
                        {x.material.name}: {x.quantity} {x.material.unit}
                        <small className="block text-slate-500">{x.fromLocation && x.toLocation ? `${x.fromLocation.name} → ${x.toLocation.name}` : x.location?.name ?? "Место не указано"}</small>
                      </span>
                      {canSeeCost && (
                        <span>{Number(x.price).toLocaleString()} ₸</span>
                      )}
                      {canSeeCost && (
                        <span>{Number(x.amount).toLocaleString()} ₸</span>
                      )}
                      <span>
                        {x.order ? (
                          <Link
                            href={`/orders/${x.order.id}`}
                            className="text-blue-400 hover:text-blue-300"
                          >
                            Заказ №{x.order.number}
                          </Link>
                        ) : (
                          "Без заказа"
                        )}
                        {x.document ? <Link href={`/documents/${x.document.id}`} className="mt-1 block text-blue-400 hover:text-blue-300">Документ {x.document.number}</Link> : null}
                      </span>
                      <span>
                        {x.employee?.name ?? "Система"}
                        <small className="block text-slate-500">
                          {new Date(x.operationAt).toLocaleString("ru-RU")}
                        </small>
                      </span>
                      {x.comment && (
                        <span className="md:col-span-6 text-sm text-slate-400">
                          {x.comment}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-between">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40"
                >
                  Назад
                </button>
                <span className="text-slate-400">
                  {page} / {Math.max(data.pagination.pages, 1)}
                </span>
                <button
                  disabled={page >= data.pagination.pages}
                  onClick={() => setPage(page + 1)}
                  className="rounded-lg bg-slate-800 px-4 py-2 text-white disabled:opacity-40"
                >
                  Далее
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function StockStatus({ item }: { item: Material }) {
  if (!item.active)
    return (
      <span className="rounded-full bg-slate-800 px-2.5 py-1 text-xs text-slate-400">
        Неактивен
      </span>
    );
  if (item.quantityKnown === false)
    return (
      <span className="rounded-full bg-blue-950 px-2.5 py-1 text-xs text-blue-300">
        Наличие подтверждено
      </span>
    );
  if (item.stock <= 0)
    return (
      <span className="rounded-full bg-red-950 px-2.5 py-1 text-xs text-red-300">
        Нет в наличии
      </span>
    );
  if (item.available !== null && item.available <= 0 && item.reserved > 0)
    return (
      <span className="rounded-full bg-blue-950 px-2.5 py-1 text-xs text-blue-300">
        Зарезервировано
      </span>
    );
  if (item.alerts.length > 0 || item.stock <= item.minimumStock)
    return (
      <span className="rounded-full bg-amber-950 px-2.5 py-1 text-xs text-amber-300">
        Мало
      </span>
    );
  return (
    <span className="rounded-full bg-emerald-950 px-2.5 py-1 text-xs text-emerald-300">
      В наличии
    </span>
  );
}

function StockValue({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-1 font-semibold text-white">{value ?? "—"}</dd>
    </div>
  );
}
