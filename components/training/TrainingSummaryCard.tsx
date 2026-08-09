"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookOpenCheck, ChevronRight } from "lucide-react";

type Summary = {
  status: "NOT_STARTED" | "IN_PROGRESS" | "READY_FOR_TEST" | "FAILED" | "PASSED";
  progressPercent: number;
  bestScore: number;
  attemptsCount: number;
  course: { title: string; questionsCount: number };
};
const names: Record<Summary["status"], string> = {
  NOT_STARTED: "Не начато",
  IN_PROGRESS: "В процессе",
  READY_FOR_TEST: "Готово к тесту",
  FAILED: "Тест не пройден",
  PASSED: "Обучение пройдено",
};

export default function TrainingSummaryCard() {
  const [data, setData] = useState<Summary | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch("/api/training", { cache: "no-store", signal: controller.signal })
        .then(async (response) => response.ok ? response.json() as Promise<Summary> : null)
        .then(setData)
        .catch(() => undefined);
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, []);
  if (!data) return null;
  const progress = Math.round(data.progressPercent);
  const action = data.status === "NOT_STARTED" ? "Начать обучение" : data.status === "PASSED" ? "Посмотреть результат" : data.status === "READY_FOR_TEST" || data.status === "FAILED" ? "Пройти тест" : "Продолжить";
  return (
    <section className={`rounded-2xl border p-4 md:p-6 ${data.status === "PASSED" ? "border-emerald-800 bg-emerald-950/20" : "border-blue-800 bg-blue-950/20"}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <BookOpenCheck className="mt-1 shrink-0 text-blue-300" />
          <div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wide text-blue-300">Обязательное обучение</p><h2 className="mt-1 text-xl font-bold text-white">{data.course.title}</h2><p className="mt-1 text-sm text-slate-300">{names[data.status]} · видео {progress}% · лучший результат {data.bestScore}/{data.course.questionsCount}</p></div>
        </div>
        <Link href="/training" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 font-semibold sm:w-auto">{action}<ChevronRight size={18} /></Link>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, progress)}%` }} /></div>
    </section>
  );
}
