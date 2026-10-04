"use client";

import { BriefcaseBusiness, Plus, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type VacancyStatus = "OPEN" | "INTERVIEW" | "OFFER" | "HIRED" | "PAUSED";
type CandidateStatus = "NEW" | "CONTACTED" | "INTERVIEW" | "OFFER" | "HIRED" | "REJECTED";
type Candidate = {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  status: CandidateStatus;
  responsibleUserId: number | null;
  responsibleUser: { id: number; name: string } | null;
  createdAt: string;
};
type Vacancy = {
  id: number;
  title: string;
  note: string | null;
  status: VacancyStatus;
  candidates: number;
  candidateRecords: Candidate[];
  createdBy: { name: string };
};
type Payload = { vacancies: Vacancy[]; assignees: Array<{ id: number; name: string }> };
type CandidateDraft = { name: string; phone: string; note: string; status: CandidateStatus; responsibleUserId: string };
type VacancyDraft = { title: string; note: string; status: VacancyStatus };

const field = "min-h-10 rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-white";
const vacancyLabels: Record<VacancyStatus, string> = { OPEN: "Открыта", INTERVIEW: "Собеседования", OFFER: "Предложение", HIRED: "Закрыта наймом", PAUSED: "Пауза" };
const candidateLabels: Record<CandidateStatus, string> = { NEW: "Новый", CONTACTED: "Связались", INTERVIEW: "Собеседование", OFFER: "Предложение", HIRED: "Принят", REJECTED: "Отказ" };
const blankCandidate = (): CandidateDraft => ({ name: "", phone: "", note: "", status: "NEW", responsibleUserId: "" });

export default function VacanciesPage() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [newVacancy, setNewVacancy] = useState({ title: "", note: "" });
  const [vacancyDrafts, setVacancyDrafts] = useState<Record<number, VacancyDraft>>({});
  const [candidateDrafts, setCandidateDrafts] = useState<Record<number, CandidateDraft>>({});
  const [newCandidates, setNewCandidates] = useState<Record<number, CandidateDraft>>({});
  const [statusFilter, setStatusFilter] = useState("ALL");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/vacancies", { cache: "no-store" });
      const body = await response.json() as Payload & { error?: string };
      if (!response.ok) throw new Error(body.error || "Не удалось загрузить вакансии");
      setData(body);
      setVacancyDrafts(Object.fromEntries(body.vacancies.map((vacancy) => [vacancy.id, { title: vacancy.title, note: vacancy.note ?? "", status: vacancy.status }])));
      setCandidateDrafts(Object.fromEntries(body.vacancies.flatMap((vacancy) => vacancy.candidateRecords.map((candidate) => [candidate.id, { name: candidate.name, phone: candidate.phone ?? "", note: candidate.note ?? "", status: candidate.status, responsibleUserId: candidate.responsibleUserId ? String(candidate.responsibleUserId) : "" }]))));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось загрузить вакансии");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  const vacancies = useMemo(() => data?.vacancies.filter((vacancy) => statusFilter === "ALL" || vacancy.status === statusFilter) ?? [], [data, statusFilter]);

  async function send(method: "POST" | "PATCH", body: Record<string, unknown>, success: string) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/vacancies", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Не удалось сохранить");
      await load(); setMessage(success);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Не удалось сохранить");
      return false;
    } finally { setBusy(false); }
  }

  const patchVacancy = (id: number, patch: Partial<VacancyDraft>) => setVacancyDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const patchCandidate = (id: number, patch: Partial<CandidateDraft>) => setCandidateDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  const patchNewCandidate = (id: number, patch: Partial<CandidateDraft>) => setNewCandidates((current) => ({ ...current, [id]: { ...(current[id] ?? blankCandidate()), ...patch } }));

  return <main className="mx-auto w-full max-w-[1450px] space-y-5 p-4 pb-24 text-slate-100 sm:p-6 lg:p-8">
    <header className="rounded-3xl border border-slate-800 bg-[#101827] p-5 sm:p-6"><p className="text-xs font-bold uppercase tracking-[.18em] text-amber-300">Компания · найм</p><h1 className="mt-2 flex items-center gap-2 text-3xl font-bold"><BriefcaseBusiness/>Вакансии и кандидаты</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Директор открывает вакансию, назначает ответственного и ведёт каждого кандидата до решения. Ранее указанные общие числа кандидатов сохранены отдельно от новых карточек.</p></header>
    {message && <p role="status" className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-100">{message}</p>}
    {loading && !data && <p className="rounded-2xl border border-slate-800 p-8 text-slate-400">Загружаем вакансии…</p>}
    {data && <>
      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5"><h2 className="text-lg font-bold">Открыть вакансию</h2><form onSubmit={async (event) => { event.preventDefault(); if (await send("POST", { action: "vacancy", ...newVacancy }, "Вакансия открыта")) setNewVacancy({ title: "", note: "" }); }} className="mt-3 flex flex-wrap items-end gap-2"><label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-slate-400">Должность<input required value={newVacancy.title} onChange={(event) => setNewVacancy({ ...newVacancy, title: event.target.value })} className={field}/></label><label className="flex min-w-52 flex-1 flex-col gap-1 text-xs text-slate-400">Комментарий<input value={newVacancy.note} onChange={(event) => setNewVacancy({ ...newVacancy, note: event.target.value })} className={field}/></label><button disabled={busy} className="inline-flex min-h-10 items-center gap-1 rounded-lg bg-amber-600 px-4 font-semibold disabled:opacity-50"><Plus size={17}/>Открыть</button></form></section>
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-slate-400">Вакансий: {vacancies.length}</p><select aria-label="Фильтр статуса вакансии" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className={field}><option value="ALL">Все статусы</option>{Object.entries(vacancyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {!vacancies.length && <p className="rounded-2xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">По выбранному статусу вакансий нет. Новую вакансию можно открыть выше.</p>}
      {vacancies.map((vacancy) => {
        const draft = vacancyDrafts[vacancy.id] ?? { title: vacancy.title, note: vacancy.note ?? "", status: vacancy.status };
        const fresh = newCandidates[vacancy.id] ?? blankCandidate();
        return <section key={vacancy.id} className="rounded-2xl border border-slate-800 bg-[#101827] p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{vacancy.title}</h2><p className="mt-1 text-sm text-slate-400">{vacancyLabels[vacancy.status]} · всего указано кандидатов: {vacancy.candidates} · карточек: {vacancy.candidateRecords.length} · открыл {vacancy.createdBy.name}</p></div></div>
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_180px_auto]"><input aria-label={`Должность вакансии ${vacancy.id}`} value={draft.title} onChange={(event) => patchVacancy(vacancy.id, { title: event.target.value })} className={field}/><input aria-label={`Комментарий вакансии ${vacancy.id}`} value={draft.note} onChange={(event) => patchVacancy(vacancy.id, { note: event.target.value })} placeholder="Комментарий" className={field}/><select aria-label={`Статус вакансии ${vacancy.id}`} value={draft.status} onChange={(event) => patchVacancy(vacancy.id, { status: event.target.value as VacancyStatus })} className={field}>{Object.entries(vacancyLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={busy} onClick={() => void send("PATCH", { action: "vacancy", id: vacancy.id, ...draft }, "Вакансия сохранена")} className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"><Save size={16}/>Сохранить</button></div>
          <div className="mt-5 border-t border-slate-800 pt-4"><h3 className="font-semibold">Добавить кандидата</h3><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_160px_1fr_180px_auto]"><input aria-label={`Имя нового кандидата вакансии ${vacancy.id}`} value={fresh.name} onChange={(event) => patchNewCandidate(vacancy.id, { name: event.target.value })} placeholder="Имя" className={field}/><input aria-label={`Телефон нового кандидата вакансии ${vacancy.id}`} value={fresh.phone} onChange={(event) => patchNewCandidate(vacancy.id, { phone: event.target.value })} placeholder="Телефон" className={field}/><input aria-label={`Комментарий нового кандидата вакансии ${vacancy.id}`} value={fresh.note} onChange={(event) => patchNewCandidate(vacancy.id, { note: event.target.value })} placeholder="Комментарий" className={field}/><select aria-label={`Ответственный нового кандидата вакансии ${vacancy.id}`} value={fresh.responsibleUserId} onChange={(event) => patchNewCandidate(vacancy.id, { responsibleUserId: event.target.value })} className={field}><option value="">Ответственный</option>{data.assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><button type="button" disabled={busy || !fresh.name.trim()} onClick={async () => { if (await send("POST", { action: "candidate", vacancyId: vacancy.id, ...fresh }, "Кандидат добавлен")) setNewCandidates((current) => ({ ...current, [vacancy.id]: blankCandidate() })); }} className="inline-flex items-center justify-center gap-1 rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"><Plus size={16}/>Добавить</button></div></div>
          <div className="mt-4 space-y-3">{vacancy.candidateRecords.map((candidate) => {
            const candidateDraft = candidateDrafts[candidate.id] ?? { name: candidate.name, phone: candidate.phone ?? "", note: candidate.note ?? "", status: candidate.status, responsibleUserId: candidate.responsibleUserId ? String(candidate.responsibleUserId) : "" };
            return <article key={candidate.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><div className="mb-2 flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{candidate.name} · {candidateLabels[candidate.status]}</span><span>Добавлен {new Date(candidate.createdAt).toLocaleDateString("ru-RU")}</span></div><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[1fr_160px_1fr_180px_180px_auto]"><input aria-label={`Имя кандидата ${candidate.id}`} value={candidateDraft.name} onChange={(event) => patchCandidate(candidate.id, { name: event.target.value })} className={field}/><input aria-label={`Телефон кандидата ${candidate.id}`} value={candidateDraft.phone} onChange={(event) => patchCandidate(candidate.id, { phone: event.target.value })} placeholder="Телефон" className={field}/><input aria-label={`Комментарий кандидата ${candidate.id}`} value={candidateDraft.note} onChange={(event) => patchCandidate(candidate.id, { note: event.target.value })} placeholder="Следующий шаг" className={field}/><select aria-label={`Ответственный кандидата ${candidate.id}`} value={candidateDraft.responsibleUserId} onChange={(event) => patchCandidate(candidate.id, { responsibleUserId: event.target.value })} className={field}><option value="">Не назначен</option>{data.assignees.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><select aria-label={`Этап кандидата ${candidate.id}`} value={candidateDraft.status} onChange={(event) => patchCandidate(candidate.id, { status: event.target.value as CandidateStatus })} className={field}>{Object.entries(candidateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={busy} onClick={() => void send("PATCH", { action: "candidate", id: candidate.id, ...candidateDraft }, "Кандидат сохранён")} className="inline-flex items-center justify-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold disabled:opacity-50"><Save size={16}/>Сохранить</button></div></article>;
          })}{!vacancy.candidateRecords.length && <p className="rounded-lg border border-dashed border-slate-800 p-4 text-sm text-slate-500">Карточек кандидатов пока нет. Если ранее было указано общее число, оно сохранено выше.</p>}</div>
        </section>;
      })}
    </>}
  </main>;
}
