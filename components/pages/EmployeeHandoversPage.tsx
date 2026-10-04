"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { HANDOVER_CATEGORIES, type HandoverCategory, type HandoverSelection } from "@/lib/services/employee-handover-categories";

type Employee = { id: number; name: string; active: boolean; payrollProfile: { id: number } | null };
type WorkRow = { id: number; title: string };
type Preview = { user: { id: number; name: string }; work: Record<HandoverCategory, WorkRow[]>; counts: Record<HandoverCategory, number>; exceptions: { blocking: { kind: string; id: number; reason: string }[]; informational: { kind: string; id: number; reason: string }[] }; unselected: HandoverCategory[]; fingerprint: string };
type Plan = { id: number; fromUserId: number; toUserId: number; scheduledAt: string; status: string; categories: HandoverSelection; fromUser: { name: string; active: boolean }; toUser: { name: string; active: boolean }; confirmedBy: { name: string } | null; confirmedAt: string | null; report: { moved: Record<string, number>; rule: string; exceptions: { reason: string }[] } | null; items: { kind: string; entityId: number }[] };
const labels: Record<HandoverCategory, string> = { clients: "Активные заявки и клиенты", orders: "Незавершённые заказы и сделки", tasks: "Задачи и напоминания календаря", followUps: "Напоминания по заявкам", approvals: "Заявки на согласование цены", blockers: "Открытые препятствия заказов", marketingTasks: "Другие назначенные задачи", recruitment: "Кандидаты в подборе" };
const allSelected = Object.fromEntries(HANDOVER_CATEGORIES.map((key) => [key, true])) as HandoverSelection;
const dateInput = (value: Date) => new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export default function EmployeeHandoversPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [fromUserId, setFromUserId] = useState(0);
  const [toUserId, setToUserId] = useState(0);
  const [scheduledAt, setScheduledAt] = useState("");
  const [now, setNow] = useState(0);
  const [categories, setCategories] = useState<HandoverSelection>(allSelected);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);

  const load = useCallback(async (oldId: number, selected: HandoverSelection) => {
    const response = await fetch(`/api/employee-handovers${oldId ? `?fromUserId=${oldId}&categories=${encodeURIComponent(JSON.stringify(selected))}` : ""}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить сотрудников и передачи");
    const payload = await response.json() as { plans: Plan[]; managers: Employee[]; preview: Preview | null };
    setEmployees(payload.managers);
    setPlans(payload.plans);
    setPreview(payload.preview);
  }, []);
  useEffect(() => {
    const start = window.setTimeout(() => {
      setScheduledAt(dateInput(new Date(Date.now() + 7 * 86_400_000)));
      setNow(Date.now());
      void load(0, allSelected).catch((cause) => setError(String(cause)));
    }, 0);
    const clock = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => { window.clearTimeout(start); window.clearInterval(clock); };
  }, [load]); // initial read only

  const refresh = async (oldId = fromUserId, selected = categories) => {
    setError(""); setBusy(true);
    try { await load(oldId, selected); } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка загрузки"); }
    finally { setBusy(false); }
  };
  const chooseFrom = (value: number) => { setFromUserId(value); void refresh(value); };
  const chooseCategory = (key: HandoverCategory) => { const next = { ...categories, [key]: !categories[key] }; setCategories(next); void refresh(fromUserId, next); };
  const request = async (method: "POST" | "PATCH", body: Record<string, unknown>) => {
    setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch("/api/employee-handovers", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Не удалось сохранить");
      setNotice(method === "POST" ? "Переход подготовлен. До подтверждения ничего не меняется." : body.action === "confirm" ? "Передача выполнена. Отчёт сохранён ниже." : body.action === "rollback" ? "Передача отменена и записи возвращены прежнему менеджеру." : body.action === "cancel" ? "Подготовка отменена." : "План обновлён.");
      setEditingId(null);
      await load(fromUserId, categories);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Ошибка"); }
    finally { setBusy(false); }
  };
  const activeManagers = employees.filter((employee) => employee.active);
  const newManagers = employees.filter((employee) => !employee.active && employee.payrollProfile);
  const prepared = plans.filter((plan) => plan.status === "PREPARED");

  return <main className="min-w-0 flex-1 space-y-5 p-4 text-slate-100 md:p-8">
    <header><h1 className="text-3xl font-bold">Передача дел менеджера</h1><p className="mt-2 max-w-3xl text-slate-300">Сначала подготовьте план. Пока директор не подтвердит переход после указанного времени, прежний менеджер продолжает работать. История продаж и авторство остаются за ним.</p></header>
    {error && <p role="alert" className="rounded-xl border border-rose-700 bg-rose-950/40 p-4 text-rose-200">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-700 bg-emerald-950/40 p-4 text-emerald-200">{notice}</p>}
    <section className="grid gap-4 rounded-2xl border border-slate-700 bg-[#101827] p-5 lg:grid-cols-2">
      <div><h2 className="text-xl font-semibold">1. Сотрудники</h2><p className="mt-1 text-sm text-slate-400">Новый менеджер должен иметь собственный неактивный аккаунт с ролью «Менеджер».</p></div>
      <Link href="/employees" className="w-fit self-center rounded-xl border border-blue-600 px-4 py-3 text-blue-200">Создать отдельный аккаунт в «Сотрудниках»</Link>
      <label className="space-y-2 text-sm">Прежний менеджер<select className="w-full rounded-xl border border-slate-600 bg-slate-900 p-3" value={fromUserId} onChange={(event) => chooseFrom(Number(event.target.value))}><option value={0}>Выберите</option>{activeManagers.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      <label className="space-y-2 text-sm">Новый менеджер<select className="w-full rounded-xl border border-slate-600 bg-slate-900 p-3" value={toUserId} onChange={(event) => setToUserId(Number(event.target.value))}><option value={0}>Выберите</option>{newManagers.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
      <label className="space-y-2 text-sm">Дата и время перехода<input type="datetime-local" className="w-full rounded-xl border border-slate-600 bg-slate-900 p-3" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
      <p className="self-end text-sm text-slate-400">Дата задаёт самое раннее время ручного подтверждения. Передача не запускается автоматически.</p>
    </section>
    <section className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><h2 className="text-xl font-semibold">2. Предварительный просмотр</h2><p className="mt-1 text-sm text-slate-400">Просмотр ничего не меняет. Перед подтверждением список обновляется и проверяется повторно.</p>
      <div className="mt-4 grid gap-2 md:grid-cols-2">{HANDOVER_CATEGORIES.map((key) => <label key={key} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 p-3"><input type="checkbox" checked={categories[key]} onChange={() => chooseCategory(key)} /><span className="flex-1">{labels[key]}</span><b>{preview?.counts[key] ?? "—"}</b></label>)}</div>
      {preview && <><div className="mt-4 grid gap-3 md:grid-cols-2">{HANDOVER_CATEGORIES.filter((key) => preview.work[key].length).map((key) => <details key={key} className="rounded-xl border border-slate-700 p-3"><summary className="cursor-pointer font-semibold">{labels[key]} · {preview.work[key].length}</summary><ul className="mt-2 max-h-48 overflow-y-auto text-sm text-slate-300">{preview.work[key].map((row) => <li key={row.id}>#{row.id} · {row.title}</li>)}</ul></details>)}</div>
        {preview.exceptions.blocking.length > 0 && <div className="mt-4 rounded-xl border border-rose-700 p-4"><h3 className="font-semibold text-rose-200">До подтверждения требуется закрыть</h3>{preview.exceptions.blocking.map((item) => <p key={`${item.kind}-${item.id}`} className="text-sm">#{item.id} · {item.reason}</p>)}</div>}
        {preview.exceptions.informational.length > 0 && <details className="mt-4 rounded-xl border border-amber-700 p-4"><summary className="cursor-pointer text-amber-200">Требуют внимания директора · {preview.exceptions.informational.length}</summary>{preview.exceptions.informational.map((item) => <p key={`${item.kind}-${item.id}`} className="mt-1 text-sm">{item.id ? `#${item.id} · ` : ""}{item.reason}</p>)}</details>}
        {preview.unselected.length > 0 && <p className="mt-3 text-sm text-amber-200">Передача не подтвердится, пока у прежнего менеджера остаются невыбранные активные записи.</p>}
      </>}
      <div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy || !fromUserId} onClick={() => void refresh()} className="rounded-xl border border-slate-500 px-4 py-3 disabled:opacity-50">Обновить список</button><button type="button" disabled={busy || !fromUserId || !toUserId || !scheduledAt || prepared.some((plan) => plan.fromUserId === fromUserId)} onClick={() => void request("POST", { fromUserId, toUserId, scheduledAt: new Date(scheduledAt).toISOString(), categories })} className="rounded-xl bg-blue-700 px-4 py-3 font-semibold disabled:opacity-50">Подготовить переход</button></div>
    </section>
    <section className="space-y-3"><h2 className="text-xl font-semibold">3. Планы и история</h2>{plans.length === 0 && <p className="text-slate-400">Планов пока нет.</p>}{plans.map((plan) => <article key={plan.id} className="rounded-2xl border border-slate-700 bg-[#101827] p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{plan.fromUser.name} → {plan.toUser.name}</h3><p className="text-sm text-slate-400">{new Date(plan.scheduledAt).toLocaleString("ru-RU")} · {plan.status === "PREPARED" ? "Подготовлен" : plan.status === "CANCELLED" ? "Отменён" : plan.status === "COMPLETED" ? "Выполнен" : "Откатан"}</p>{plan.confirmedAt && <p className="text-xs text-slate-400">Подтвердил: {plan.confirmedBy?.name ?? "Директор"} · {new Date(plan.confirmedAt).toLocaleString("ru-RU")}</p>}<p className="text-xs text-slate-500">{plan.fromUser.name}: {plan.fromUser.active ? "действующий" : "бывший"} · {plan.toUser.name}: {plan.toUser.active ? "действующий" : "неактивный"}</p></div><span className="rounded-full bg-slate-700 px-3 py-1 text-xs">#{plan.id}</span></div>
      {plan.status === "PREPARED" && <div className="mt-4 flex flex-wrap gap-2">{editingId === plan.id ? <><input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} className="rounded-xl bg-slate-900 p-2" /><select value={toUserId || plan.toUserId} onChange={(event) => setToUserId(Number(event.target.value))} className="rounded-xl bg-slate-900 p-2">{newManagers.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select><button type="button" disabled={busy} onClick={() => void request("PATCH", { id: plan.id, action: "update", scheduledAt: new Date(scheduledAt).toISOString(), toUserId: toUserId || plan.toUserId, categories })} className="rounded-xl bg-blue-700 px-4 py-2">Сохранить</button></> : <button type="button" onClick={() => { setEditingId(plan.id); setScheduledAt(dateInput(new Date(plan.scheduledAt))); setToUserId(plan.toUserId); setCategories(plan.categories); setFromUserId(plan.fromUserId); void refresh(plan.fromUserId, plan.categories); }} className="rounded-xl border border-slate-600 px-4 py-2">Изменить</button>}
        <button type="button" disabled={busy} onClick={() => { if (window.confirm("Отменить подготовленный переход? Данные сотрудников останутся без изменений.")) void request("PATCH", { id: plan.id, action: "cancel" }); }} className="rounded-xl border border-rose-700 px-4 py-2 text-rose-200">Отменить</button>
        <button type="button" disabled={busy || !preview || preview.user.id !== plan.fromUserId || preview.exceptions.blocking.length > 0 || preview.unselected.length > 0 || now < new Date(plan.scheduledAt).getTime()} onClick={() => { if (window.confirm(`Подтвердить передачу ${plan.fromUser.name} → ${plan.toUser.name}? Прежний доступ будет закрыт.`)) void request("PATCH", { id: plan.id, action: "confirm", fingerprint: preview!.fingerprint }); }} className="rounded-xl bg-emerald-700 px-4 py-2 font-semibold disabled:opacity-50">Подтвердить переход</button>
        <button type="button" disabled={busy} onClick={() => { setCategories(plan.categories); setFromUserId(plan.fromUserId); void refresh(plan.fromUserId, plan.categories); }} className="rounded-xl border border-slate-600 px-4 py-2">Посмотреть записи</button>
      </div>}
      {plan.status === "COMPLETED" && <button type="button" disabled={busy} onClick={() => { if (window.confirm("Откатить передачу? Это возможно только если после неё никто не работал с переданными данными.")) void request("PATCH", { id: plan.id, action: "rollback" }); }} className="mt-4 rounded-xl border border-amber-700 px-4 py-2 text-amber-200">Безопасный откат</button>}
      {plan.report && <details className="mt-4"><summary className="cursor-pointer text-blue-200">Итоговый отчёт · {plan.items.length} записей</summary><p className="mt-2 text-sm text-slate-300">{plan.report.rule}</p><p className="mt-2 text-sm text-slate-300">{Object.entries(plan.report.moved).map(([key, count]) => `${key}: ${count}`).join(" · ")}</p>{plan.report.exceptions?.map((item, index) => <p key={index} className="text-sm text-amber-200">{item.reason}</p>)}<ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs text-slate-300">{plan.items.map((item) => <li key={`${item.kind}-${item.entityId}`}>{labels[item.kind as HandoverCategory] ?? item.kind} · #{item.entityId}</li>)}</ul></details>}
    </article>)}</section>
  </main>;
}
