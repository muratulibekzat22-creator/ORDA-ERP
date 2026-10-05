"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpenCheck, ChevronRight } from "lucide-react";

type Summary = {
  status: "NOT_STARTED" | "IN_PROGRESS" | "READY_FOR_TEST" | "FAILED" | "PASSED";
  progressPercent: number;
  bestScore: number;
  attemptsCount: number;
  passedLessonsCount: number;
  lessonsCount: number;
  course: { title: string; questionsCount: number };
};
const names: Record<Summary["status"], string> = {
  NOT_STARTED: "Не начато",
  IN_PROGRESS: "В процессе",
  READY_FOR_TEST: "Все тесты пройдены",
  FAILED: "Тест не пройден",
  PASSED: "Обучение пройдено",
};

export default function TrainingSummaryCard() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/training", { cache: "no-store", signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error("training unavailable");
          return response.json() as Promise<Summary>;
        })
        .then((next) => { setData(next); setUnavailable(false); })
        .catch((error: unknown) => {
          if (!(error instanceof DOMException && error.name === "AbortError")) setUnavailable(true);
        })
        .finally(() => setLoading(false));
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, []);
  if (loading) return (
    <section aria-busy="true" className="rounded-2xl border border-blue-900 bg-blue-950/20 p-4 text-sm text-blue-100 md:p-6">
      Загружаем обязательное обучение…
    </section>
  );
  if (!data) return (
    <section role={unavailable ? "alert" : undefined} className="rounded-2xl border border-amber-800 bg-amber-950/20 p-4 md:p-6">
      <p className="font-semibold text-amber-100">Обязательное обучение не загрузилось</p>
      <p className="mt-1 text-sm text-amber-200/80">Откройте курс напрямую. На странице обучения можно повторить загрузку.</p>
      <Link href="/training" className="mt-4 inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold text-white">Открыть обучение<ChevronRight size={18} /></Link>
    </section>
  );
  const progress = Math.round(data.progressPercent);
  const action = data.status === "NOT_STARTED" ? "Начать обучение" : data.status === "PASSED" ? "Посмотреть результат" : data.status === "READY_FOR_TEST" ? "Завершить обучение" : "Продолжить";
  return (
    <section className={`rounded-2xl border p-4 md:p-6 ${data.status === "PASSED" ? "border-emerald-800 bg-emerald-950/20" : "border-blue-800 bg-blue-950/20"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <BookOpenCheck className="mt-1 shrink-0 text-blue-300" />
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Обязательное обучение</p><h2 className="mt-1 text-xl font-bold text-white">{data.course.title}</h2><p className="mt-1 text-sm text-slate-300">{names[data.status]} · просмотр {progress}% · тесты по видео {data.passedLessonsCount}/{data.lessonsCount}</p></div>
        </div>
        <Link href="/training" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold sm:w-auto">{action}<ChevronRight size={18} /></Link>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, progress)}%` }} /></div>
    </section>
  );
}
