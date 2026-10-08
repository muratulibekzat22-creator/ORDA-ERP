"use client";

import { useEffect, useState } from "react";

type UserRow = {
  id: number;
  name: string;
  email: string;
  role: string;
  active: boolean;
};

type Audit = {
  candidateCount: number;
  candidates: UserRow[];
  references: Record<string, number>;
  activeRealEmployees: UserRow[];
  inactiveNonTestAccounts: UserRow[];
};

export default function TestAccountAuditPage() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState("");

  useEffect(() => {
    void fetch("/api/maintenance/test-accounts", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error || "Не удалось выполнить аудит");
        return response.json() as Promise<Audit>;
      })
      .then(setAudit)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Не удалось выполнить аудит"));
  }, []);

  const deleteTestAccounts = async () => {
    if (!audit) return;
    setDeleting(true);
    setError("");
    const response = await fetch("/api/maintenance/test-accounts", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "DELETE_CONFIRMED_TEST_ACCOUNTS", expectedCandidateCount: audit.candidateCount }),
    });
    const payload = await response.json() as { error?: string; deletedUsers?: number; deletedProfiles?: number };
    if (!response.ok) {
      setError(payload.error || "Удаление не выполнено");
      setDeleting(false);
      return;
    }
    setResult(`Удалено аккаунтов: ${payload.deletedUsers ?? 0}. Удалено тестовых профилей сотрудников: ${payload.deletedProfiles ?? 0}.`);
    setAudit({ ...audit, candidateCount: 0, candidates: [] });
    setDeleting(false);
  };

  return <main className="space-y-5 p-4 sm:p-6">
    <div><h1 className="text-2xl font-bold text-white">Аудит тестовых аккаунтов</h1><p className="mt-1 text-sm text-slate-400">Только чтение. На этой странице ничего не удаляется.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-500/30 bg-red-950/30 p-4 text-red-200">{error}</p>}
    {!audit && !error && <p className="text-slate-300">Загрузка…</p>}
    {audit && <>
      <section className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-4"><h2 className="font-bold text-amber-100">Найдено тестовых аккаунтов: {audit.candidateCount}</h2><p className="mt-2 text-sm text-amber-200">Связанные записи: {Object.entries(audit.references).map(([model, count]) => `${model}: ${count}`).join(" · ") || "нет"}</p></section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4"><h2 className="font-bold text-white">Будут удалены</h2><div className="mt-3 space-y-2">{audit.candidates.map((user) => <div key={user.id} className="rounded-lg bg-slate-950 p-3 text-sm text-slate-200"><b>{user.name}</b> · {user.email} · {user.role} · ID {user.id}</div>)}</div></section>
      <section className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-4"><h2 className="font-bold text-emerald-100">Действующие сотрудники — сохраняются ({audit.activeRealEmployees.length})</h2><p className="mt-2 text-sm text-emerald-200">{audit.activeRealEmployees.map((user) => user.name).join(" · ")}</p></section>
      <section className="rounded-2xl border border-slate-700 bg-slate-900/40 p-4"><h2 className="font-bold text-slate-200">Неактивные реальные аккаунты — сохраняются ({audit.inactiveNonTestAccounts.length})</h2><p className="mt-2 text-sm text-slate-400">{audit.inactiveNonTestAccounts.map((user) => `${user.name} (${user.email})`).join(" · ") || "Нет"}</p></section>
      {audit.candidateCount > 0 && <button type="button" onClick={() => void deleteTestAccounts()} disabled={deleting} className="min-h-12 rounded-xl bg-red-700 px-5 font-bold text-white disabled:opacity-50">{deleting ? "Удаление…" : `Удалить ${audit.candidateCount} тестовых аккаунтов`}</button>}
      {result && <p role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/30 p-4 text-emerald-100">{result}</p>}
    </>}
  </main>;
}
