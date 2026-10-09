"use client";

import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

type Direction = "INCOME" | "EXPENSE";
type Kind = "CLIENT_PAYMENT" | "INCOME" | "EXPENSE";
type Category = { id: number; code: string; name: string; direction: Direction };
type OrderOption = { id: number; name: string; clientId: number; paymentMethod: string };
type ClientOption = { id: number; name: string };
type StatementImport = {
  id: number;
  provider: string;
  accountLabel: string | null;
  fileName: string;
  status: string;
  totalRows: number;
  importedRows: number;
  duplicateRows: number;
  createdAt: string;
  _count: { transactions: number };
};
type Transaction = {
  id: number;
  rowNumber: number;
  operationDate: string;
  direction: Direction;
  amount: number;
  currency: string;
  counterparty: string | null;
  description: string | null;
  reference: string | null;
  status: string;
  suggestedKind: string;
  confidence: number;
  matchReason: string | null;
  selected: boolean;
  suggestedCategoryId: number | null;
  suggestedOrderId: number | null;
  suggestedClientId: number | null;
  suggestedRecurringExpensePlanId: number | null;
  suggestedCategory: { id: number; name: string; direction: Direction } | null;
  suggestedOrder: { id: number; number: string; balance: number; client: { name: string } } | null;
  suggestedClient: { id: number; name: string } | null;
  suggestedRecurringExpensePlan: { id: number; name: string } | null;
};
type Workspace = {
  imports: StatementImport[];
  selectedImportId: number | null;
  transactions: Transaction[];
  options: { categories: Category[]; orders: OrderOption[]; clients: ClientOption[] };
};
type Draft = {
  selected: boolean;
  kind: Kind;
  categoryId: string;
  orderId: string;
  clientId: string;
  recurringExpensePlanId: string;
  rememberRule: boolean;
};

const emptyWorkspace: Workspace = { imports: [], selectedImportId: null, transactions: [], options: { categories: [], orders: [], clients: [] } };

const money = (value: number) => new Intl.NumberFormat("ru-RU", { style: "currency", currency: "KZT", maximumFractionDigits: 0 }).format(value || 0);

const statusLabels: Record<string, string> = {
  REVIEW: "Нужна проверка",
  PARTIAL: "Частично проведено",
  COMPLETED: "Готово",
  PENDING: "На проверке",
  POSTED: "Проведено",
  MATCHED: "Уже учтено",
  SKIPPED: "Пропущено",
};

function draftFor(item: Transaction): Draft {
  const proposed = item.suggestedKind === "CLIENT_PAYMENT" || item.suggestedKind === "INCOME" || item.suggestedKind === "EXPENSE"
    ? item.suggestedKind as Kind
    : item.direction === "INCOME" ? "INCOME" : "EXPENSE";
  return {
    selected: item.status === "PENDING" && item.selected && item.suggestedKind !== "ALREADY_RECORDED",
    kind: proposed,
    categoryId: item.suggestedCategoryId ? String(item.suggestedCategoryId) : "",
    orderId: item.suggestedOrderId ? String(item.suggestedOrderId) : "",
    clientId: item.suggestedClientId ? String(item.suggestedClientId) : "",
    recurringExpensePlanId: item.suggestedRecurringExpensePlanId ? String(item.suggestedRecurringExpensePlanId) : "",
    rememberRule: Boolean(item.counterparty),
  };
}

export default function BankStatementPanel({ onChanged }: { onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const applyWorkspace = useCallback((next: Workspace) => {
    setWorkspace(next);
    setDrafts(Object.fromEntries(next.transactions.map((item) => [item.id, draftFor(item)])));
  }, []);

  const load = useCallback(async (importId?: number) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/finance/statements${importId ? `?importId=${importId}` : ""}`, { cache: "no-store" });
      const body = await response.json() as Workspace & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить выписки");
      applyWorkspace(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить выписки");
    } finally {
      setLoading(false);
    }
  }, [applyWorkspace]);

  useEffect(() => {
    // Opening the panel synchronizes its persisted server-side import state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open && workspace.imports.length === 0) void load();
  }, [load, open, workspace.imports.length]);

  const pending = workspace.transactions.filter((item) => item.status === "PENDING");
  const selected = pending.filter((item) => drafts[item.id]?.selected);
  const selectedImport = workspace.imports.find((item) => item.id === workspace.selectedImportId) ?? null;

  const setDraft = (id: number, patch: Partial<Draft>) => setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/finance/statements", { method: "POST", body: form });
      const body = await response.json() as { replay?: boolean; workspace?: Workspace; error?: string };
      if (!response.ok || !body.workspace) throw new Error(body.error || "Не удалось импортировать выписку");
      applyWorkspace(body.workspace);
      setMessage(body.replay ? "Эта выписка уже загружалась — дубли не созданы." : "Выписка разобрана. Проверьте предложения и проведите выбранные операции.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось импортировать выписку");
    } finally {
      setUploading(false);
    }
  }

  async function postSelected() {
    if (!workspace.selectedImportId || selected.length === 0) return;
    const invalid = selected.find((item) => {
      const draft = drafts[item.id];
      return draft.kind === "CLIENT_PAYMENT" ? !draft.orderId : !draft.categoryId;
    });
    if (invalid) { setError(`Операция от ${new Date(invalid.operationDate).toLocaleDateString("ru-RU")}: выберите ${drafts[invalid.id].kind === "CLIENT_PAYMENT" ? "заказ" : "категорию"}.`); return; }
    setPosting(true);
    setError("");
    setMessage("");
    try {
      const decisions = selected.map((item) => {
        const draft = drafts[item.id];
        const order = workspace.options.orders.find((option) => String(option.id) === draft.orderId);
        return {
          transactionId: item.id,
          action: "POST",
          kind: draft.kind,
          orderId: draft.orderId || null,
          clientId: draft.kind === "CLIENT_PAYMENT" ? order?.clientId ?? null : draft.clientId || null,
          categoryId: draft.kind === "CLIENT_PAYMENT" ? null : draft.categoryId || null,
          recurringExpensePlanId: draft.recurringExpensePlanId || null,
          rememberRule: draft.rememberRule,
        };
      });
      const response = await fetch(`/api/finance/statements/${workspace.selectedImportId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions }) });
      const body = await response.json() as { results?: Array<{ ok: boolean; error?: string }>; workspace?: Workspace; error?: string };
      if (!response.ok || !body.workspace) throw new Error(body.error || "Не удалось провести операции");
      applyWorkspace(body.workspace);
      const failures = body.results?.filter((item) => !item.ok) ?? [];
      if (failures.length) setError(`${failures.length} операций не проведено: ${failures[0].error ?? "проверьте данные"}`);
      const completed = (body.results?.length ?? 0) - failures.length;
      if (completed) { setMessage(`Проведено операций: ${completed}. Доходы, расходы и остатки обновлены.`); onChanged(); }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось провести операции");
    } finally {
      setPosting(false);
    }
  }

  async function skip(item: Transaction) {
    if (!workspace.selectedImportId || !window.confirm("Отметить эту строку выписки как уже учтённую / не проводить?")) return;
    setPosting(true);
    setError("");
    try {
      const response = await fetch(`/api/finance/statements/${workspace.selectedImportId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions: [{ transactionId: item.id, action: "SKIP" }] }) });
      const body = await response.json() as { workspace?: Workspace; error?: string };
      if (!response.ok || !body.workspace) throw new Error(body.error || "Не удалось обновить операцию");
      applyWorkspace(body.workspace);
      setMessage("Строка отмечена как уже учтённая / пропущенная.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось обновить операцию");
    } finally {
      setPosting(false);
    }
  }

  const selectedIncome = useMemo(() => selected.filter((item) => item.direction === "INCOME").reduce((sum, item) => sum + item.amount, 0), [selected]);
  const selectedExpense = useMemo(() => selected.filter((item) => item.direction === "EXPENSE").reduce((sum, item) => sum + item.amount, 0), [selected]);

  return (
    <section className="rounded-2xl border border-sky-800/70 bg-[#101827] p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold text-white">Сверка с выпиской Kaspi</h2>
          <p className="mt-1 text-sm text-slate-400">Загрузите выписку один раз: повторы не создадут дубли, а подтверждённые контрагенты запомнятся.</p>
        </div>
        <button type="button" onClick={() => setOpen((value) => !value)} className="min-h-10 rounded-xl bg-sky-900 px-4 text-sm font-semibold text-sky-100">
          {open ? "Скрыть" : "Открыть импорт"}
        </button>
      </div>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-3 rounded-xl bg-slate-900 p-4 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <p className="text-sm text-slate-200">Kaspi Pay → Мой Банк → Счёт → Выписка → <b>Excel</b></p>
              <p className="mt-1 text-xs text-slate-500">Поддерживаются .xlsx, .csv и текстовый формат 1C до 10 МБ. Для PDF сначала выберите выгрузку Excel.</p>
            </div>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-sky-600 px-4 font-semibold text-white">
              {uploading ? "Анализ…" : "Прикрепить выписку"}
              <input disabled={uploading || posting} type="file" accept=".xlsx,.csv,.txt" onChange={upload} className="sr-only" />
            </label>
          </div>

          {workspace.imports.length > 0 && (
            <label className="block text-sm text-slate-300">
              <span className="mb-2 block">Загруженная выписка</span>
              <select value={workspace.selectedImportId ?? ""} onChange={(event) => void load(Number(event.target.value))} className="input">
                {workspace.imports.map((item) => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleDateString("ru-RU")} · {item.fileName} · {statusLabels[item.status] ?? item.status}</option>)}
              </select>
            </label>
          )}

          {selectedImport && (
            <div className="grid gap-2 text-sm sm:grid-cols-4">
              <Mini label="Операций в файле" value={selectedImport.totalRows} />
              <Mini label="Новых" value={selectedImport.importedRows} />
              <Mini label="Дублей пропущено" value={selectedImport.duplicateRows} />
              <Mini label="На проверке" value={pending.length} />
            </div>
          )}

          {message && <p role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-300">{message}</p>}
          {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{error}</p>}
          {loading ? <p className="text-sm text-slate-400">Загрузка…</p> : workspace.transactions.length === 0 && selectedImport ? <p className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Новых операций нет: файл полностью совпал с уже загруженными выписками.</p> : null}

          {pending.length > 0 && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 rounded-xl bg-slate-900 p-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-300">Выбрано: {selected.length} · доход {money(selectedIncome)} · расход {money(selectedExpense)}</p>
                <button type="button" disabled={posting || selected.length === 0} onClick={() => void postSelected()} className="min-h-11 rounded-xl bg-blue-600 px-4 font-semibold text-white disabled:opacity-40">{posting ? "Проведение…" : `Провести выбранные (${selected.length})`}</button>
              </div>
              {workspace.transactions.map((item) => {
                const draft = drafts[item.id];
                if (!draft) return null;
                const categories = workspace.options.categories.filter((category) => category.direction === item.direction);
                const resolved = item.status !== "PENDING";
                return (
                  <article key={item.id} className={`rounded-xl border p-4 ${resolved ? "border-slate-800 opacity-65" : item.suggestedKind === "ALREADY_RECORDED" ? "border-amber-800 bg-amber-950/15" : "border-slate-700 bg-slate-900/70"}`}>
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
                      {!resolved && item.suggestedKind !== "ALREADY_RECORDED" && <input aria-label={`Выбрать операцию ${item.id}`} type="checkbox" checked={draft.selected} onChange={(event) => setDraft(item.id, { selected: event.target.checked })} className="mt-1 size-5 accent-blue-600" />}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <b className={item.direction === "INCOME" ? "text-emerald-300" : "text-rose-300"}>{item.direction === "INCOME" ? "+" : "−"}{money(item.amount)}</b>
                          <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{new Date(item.operationDate).toLocaleDateString("ru-RU")}</span>
                          <span className="rounded-full bg-slate-800 px-2 py-1 text-xs text-slate-300">{resolved ? statusLabels[item.status] ?? item.status : `Уверенность ${item.confidence}%`}</span>
                          {item.suggestedRecurringExpensePlan && <span className="rounded-full bg-violet-950 px-2 py-1 text-xs text-violet-200">План: {item.suggestedRecurringExpensePlan.name}</span>}
                        </div>
                        <p className="mt-2 break-words text-sm text-white">{item.counterparty || "Контрагент не указан"}</p>
                        {item.description && <p className="mt-1 break-words text-xs text-slate-400">{item.description}</p>}
                        {item.matchReason && <p className="mt-2 text-xs text-sky-300">{item.matchReason}</p>}
                      </div>
                      {!resolved && (
                        <div className="grid min-w-0 gap-2 lg:w-[26rem]">
                          {item.suggestedKind === "ALREADY_RECORDED" ? (
                            <button type="button" disabled={posting} onClick={() => void skip(item)} className="min-h-10 rounded-lg bg-amber-900 px-3 text-sm text-amber-100">Подтвердить: уже учтено</button>
                          ) : (
                            <>
                              {item.direction === "INCOME" && (
                                <select aria-label="Тип поступления" value={draft.kind} onChange={(event) => setDraft(item.id, { kind: event.target.value as Kind })} className="input">
                                  <option value="CLIENT_PAYMENT">Оплата клиента по заказу</option>
                                  <option value="INCOME">Другой доход</option>
                                </select>
                              )}
                              {draft.kind === "CLIENT_PAYMENT" ? (
                                <select aria-label="Заказ для оплаты" value={draft.orderId} onChange={(event) => setDraft(item.id, { orderId: event.target.value })} className="input">
                                  <option value="">Выберите заказ</option>
                                  {workspace.options.orders.map((order) => <option key={order.id} value={order.id}>{order.name}</option>)}
                                </select>
                              ) : (
                                <select aria-label="Категория операции" value={draft.categoryId} onChange={(event) => setDraft(item.id, { categoryId: event.target.value, recurringExpensePlanId: event.target.value === String(item.suggestedCategoryId) ? draft.recurringExpensePlanId : "" })} className="input">
                                  <option value="">Выберите категорию</option>
                                  {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                                </select>
                              )}
                              {draft.kind === "INCOME" && (
                                <select aria-label="Клиент для дохода" value={draft.clientId} onChange={(event) => setDraft(item.id, { clientId: event.target.value })} className="input">
                                  <option value="">Без клиента</option>
                                  {workspace.options.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                                </select>
                              )}
                              {item.counterparty && <label className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={draft.rememberRule} onChange={(event) => setDraft(item.id, { rememberRule: event.target.checked })} className="size-4 accent-blue-600" />Запомнить выбор для этого контрагента</label>}
                              <button type="button" disabled={posting} onClick={() => void skip(item)} className="text-left text-xs text-slate-500 underline">Не проводить эту строку</button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl bg-slate-900 p-3"><p className="text-xs text-slate-500">{label}</p><b className="mt-1 block text-white">{value}</b></div>;
}
