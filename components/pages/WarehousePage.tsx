"use client";

import { FormEvent, useEffect, useState } from "react";
import { useIdempotencyKey } from "@/hooks/useIdempotencyKey";

type Data = {
  materials: Array<{ id: number; name: string; category: string; unit: string; minimumStock: number; stock: number; purchasePrice: string; supplier: string | null }>;
  orders: Array<{ id: number; number: string; client: { name: string } }>;
  movements: Array<{ id: number; type: string; quantity: number; price: string; supplier: string | null; comment: string | null; createdAt: string; material: { name: string; unit: string }; order: { number: string } | null }>;
  stats: { materials: number; lowStock: number; stockValue: number; suppliers: string[] };
};
type MoveState = { type: string; materialId: string; orderId: string; quantity: string; price: string; supplier: string; comment: string; date: string };

const empty: Data = { materials: [], orders: [], movements: [], stats: { materials: 0, lowStock: 0, stockValue: 0, suppliers: [] } };
const initialMove: MoveState = { type: "incoming", materialId: "", orderId: "", quantity: "", price: "", supplier: "", comment: "", date: new Date().toISOString().slice(0, 10) };

export default function WarehousePage() {
  const { getKey, reset } = useIdempotencyKey();
  const [data, setData] = useState<Data>(empty);
  const [tab, setTab] = useState("Материалы");
  const [error, setError] = useState("");
  const [savingMove, setSavingMove] = useState(false);
  const [material, setMaterial] = useState({ name: "", category: "", unit: "шт", minimumStock: "0", purchasePrice: "0", supplier: "" });
  const [move, setMove] = useState<MoveState>(initialMove);

  async function load() {
    const response = await fetch("/api/warehouse");
    if (!response.ok) throw new Error("Не удалось загрузить склад");
    setData(await response.json() as Data);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : "Ошибка склада")
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function submitMaterial(event: FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/warehouse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "material", ...material }) });
    if (!response.ok) { setError((await response.json() as { error: string }).error); return; }
    setMaterial({ name: "", category: "", unit: "шт", minimumStock: "0", purchasePrice: "0", supplier: "" });
    await load();
  }

  async function submitMove(event: FormEvent) {
    event.preventDefault();
    setSavingMove(true);
    setError("");
    try {
      const response = await fetch("/api/warehouse", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": getKey() },
        body: JSON.stringify(move),
      });
      if (!response.ok) { setError((await response.json() as { error: string }).error); return; }
      reset();
      setMove({ ...move, materialId: "", orderId: "", quantity: "", price: "", comment: "" });
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ошибка склада");
    } finally {
      setSavingMove(false);
    }
  }

  const low = data.materials.filter((item) => item.stock <= item.minimumStock);
  return <section className="flex-1 overflow-auto p-8"><h1 className="text-3xl font-bold text-white">Склад</h1><p className="mt-2 text-slate-400">Материалы, остатки, поставщики и операции</p><div className="my-6 grid gap-4 md:grid-cols-4">{[["Материалов", data.stats.materials, "text-blue-400"], ["Заканчивается", data.stats.lowStock, "text-red-400"], ["Стоимость склада", `${data.stats.stockValue.toLocaleString()} ₸`, "text-green-400"], ["Поставщиков", data.stats.suppliers.length, "text-purple-400"]].map(([title, value, color]) => <div key={String(title)} className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><p className="text-slate-400">{title}</p><p className={`mt-2 text-3xl font-bold ${color}`}>{value}</p></div>)}</div><div className="mb-5 flex flex-wrap gap-2">{["Материалы", "Остатки", "Приход", "Расход", "Поставщики", "История операций"].map((item) => <button type="button" key={item} onClick={() => setTab(item)} className={`rounded-xl px-4 py-2 ${tab === item ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}>{item}</button>)}</div>{error && <p className="mb-4 text-red-400">{error}</p>}{(tab === "Материалы" || tab === "Остатки") && <div className="space-y-5"><form onSubmit={submitMaterial} className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-5 md:grid-cols-3">{(["name", "category", "unit", "minimumStock", "purchasePrice", "supplier"] as const).map((field) => <input required={field === "name"} key={field} value={material[field]} onChange={(event) => setMaterial({ ...material, [field]: event.target.value })} placeholder={{ name: "Название", category: "Категория", unit: "Ед. изм.", minimumStock: "Мин. остаток", purchasePrice: "Закупочная цена", supplier: "Поставщик" }[field]} className="rounded-xl bg-slate-900 p-3 text-white" />)}<button className="rounded-xl bg-blue-600 p-3 text-white">Добавить материал</button></form><Table materials={tab === "Остатки" ? low : data.materials} /></div>}{tab === "Приход" && <MoveForm title="Приход материала" data={data} move={move} setMove={setMove} onSubmit={submitMove} saving={savingMove} incoming />}{tab === "Расход" && <MoveForm title="Расход материала" data={data} move={move} setMove={setMove} onSubmit={submitMove} saving={savingMove} />}{tab === "Поставщики" && <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6 text-white">{data.stats.suppliers.length ? data.stats.suppliers.map((item) => <p key={item} className="border-b border-slate-800 py-3">{item}</p>) : "Поставщиков пока нет"}</div>}{tab === "История операций" && <div className="rounded-2xl border border-slate-700 bg-[#101827] p-6">{data.movements.map((item) => <div key={item.id} className="border-b border-slate-800 py-3 text-slate-300"><b className={item.type === "incoming" ? "text-green-400" : "text-orange-400"}>{item.type === "incoming" ? "Приход" : "Расход"}</b> · {item.material.name}: {item.quantity} {item.material.unit} {item.order && `• ${item.order.number}`}<span className="float-right">{new Date(item.createdAt).toLocaleDateString("ru-RU")}</span></div>)}</div>}</section>;
}

function Table({ materials }: { materials: Data["materials"] }) { return <div className="overflow-hidden rounded-2xl border border-slate-700 bg-[#101827]"><table className="w-full text-left"><thead className="bg-slate-900 text-slate-400"><tr><th className="p-4">Материал</th><th>Категория</th><th>Остаток</th><th>Цена</th><th>Поставщик</th></tr></thead><tbody>{materials.map((item) => <tr key={item.id} className="border-t border-slate-800"><td className="p-4 text-white">{item.name}</td><td>{item.category}</td><td className={item.stock <= item.minimumStock ? "text-red-400" : "text-green-400"}>{item.stock} {item.unit} / мин. {item.minimumStock}</td><td>{Number(item.purchasePrice).toLocaleString()} ₸</td><td>{item.supplier || "—"}</td></tr>)}</tbody></table></div>; }

function MoveForm({ title, data, move, setMove, onSubmit, saving, incoming = false }: { title: string; data: Data; move: MoveState; setMove: (value: MoveState) => void; onSubmit: (event: FormEvent) => void; saving: boolean; incoming?: boolean }) { return <form onSubmit={onSubmit} className="grid gap-3 rounded-2xl border border-slate-700 bg-[#101827] p-6 md:grid-cols-2"><h2 className="md:col-span-2 text-xl font-bold text-white">{title}</h2><select required value={move.materialId} onChange={(event) => setMove({ ...move, materialId: event.target.value, type: incoming ? "incoming" : "outgoing" })} className="rounded-xl bg-slate-900 p-3 text-white"><option value="">Материал</option>{data.materials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{incoming ? <input value={move.supplier} onChange={(event) => setMove({ ...move, supplier: event.target.value })} placeholder="Поставщик" className="rounded-xl bg-slate-900 p-3 text-white" /> : <select required value={move.orderId} onChange={(event) => setMove({ ...move, orderId: event.target.value })} className="rounded-xl bg-slate-900 p-3 text-white"><option value="">Заказ</option>{data.orders.map((item) => <option key={item.id} value={item.id}>{item.number} — {item.client.name}</option>)}</select>}<input required type="number" min="0.01" value={move.quantity} onChange={(event) => setMove({ ...move, quantity: event.target.value })} placeholder="Количество" className="rounded-xl bg-slate-900 p-3 text-white" />{incoming && <input required type="number" min="0" value={move.price} onChange={(event) => setMove({ ...move, price: event.target.value })} placeholder="Цена" className="rounded-xl bg-slate-900 p-3 text-white" />}<input type="date" value={move.date} onChange={(event) => setMove({ ...move, date: event.target.value })} className="rounded-xl bg-slate-900 p-3 text-white" /><input value={move.comment} onChange={(event) => setMove({ ...move, comment: event.target.value })} placeholder="Комментарий" className="rounded-xl bg-slate-900 p-3 text-white" /><button disabled={saving} className="rounded-xl bg-blue-600 p-3 text-white disabled:opacity-50">{saving ? "Сохранение..." : "Сохранить"}</button></form>; }
