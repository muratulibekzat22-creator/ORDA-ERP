"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  PlayCircle,
} from "lucide-react";

type AttemptHistory = {
  id: number;
  score: number | null;
  percent: number | null;
  status: string;
  startedAt: string;
  completedAt: string | null;
};
type Assignment = {
  id: number;
  status: "NOT_STARTED" | "IN_PROGRESS" | "READY_FOR_TEST" | "FAILED" | "PASSED";
  progressPercent: number;
  acknowledgedAt: string | null;
  attemptsCount: number;
  bestScore: number;
  bestPercent: number;
  passedAt: string | null;
  canAcknowledge: boolean;
  canStartQuiz: boolean;
  course: {
    version: number;
    title: string;
    description: string;
    youtubeVideoId: string;
    passScorePercent: number;
    requiredCoverage: number;
    questionsCount: number;
  };
  attempts: AttemptHistory[];
};
type Question = {
  id: number;
  position: number;
  question: string;
  options: string[];
};
type Attempt = { attemptId: number; startedAt: string; questions: Question[] };
type Result = {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  review: Array<{
    position: number;
    correct: boolean;
    correctOption: number;
    explanation: string;
  }>;
};
type YouTubePlayer = {
  getCurrentTime: () => number;
  getDuration: () => number;
  getPlayerState: () => number;
  destroy: () => void;
};
type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      playerVars: Record<string, number>;
      events: { onReady: () => void };
    },
  ) => YouTubePlayer;
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const statusNames: Record<Assignment["status"], string> = {
  NOT_STARTED: "Не начато",
  IN_PROGRESS: "В процессе",
  READY_FOR_TEST: "Готово к тесту",
  FAILED: "Тест не пройден",
  PASSED: "Обучение пройдено",
};

const playerStates: Record<number, string> = {
  1: "PLAYING",
  2: "PAUSED",
  0: "ENDED",
  3: "BUFFERING",
  5: "CUED",
  [-1]: "UNSTARTED",
};

export default function TrainingWorkspace() {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState(false);
  const playerHost = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const assignmentRef = useRef<Assignment | null>(null);

  useEffect(() => {
    assignmentRef.current = assignment;
  }, [assignment]);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/training", { cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось загрузить обучение");
    else {
      setAssignment(body as Assignment);
      setError("");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const sendHeartbeat = useCallback(async () => {
    const currentAssignment = assignmentRef.current;
    if (!player.current || !currentAssignment) return;
    const duration = player.current.getDuration();
    if (!duration) return;
    try {
      const response = await fetch("/api/training/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentTime: player.current.getCurrentTime(),
          duration,
          playerState:
            playerStates[player.current.getPlayerState()] ?? "UNKNOWN",
          courseVersion: currentAssignment.course.version,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error ?? "heartbeat failed");
      setAssignment((current) =>
        current
          ? {
              ...current,
              progressPercent: Math.max(
                current.progressPercent,
                Number(body.progressPercent ?? 0),
              ),
              canAcknowledge: Boolean(body.canAcknowledge),
              canStartQuiz: Boolean(body.canStartQuiz),
              status:
                current.status === "NOT_STARTED" &&
                Number(body.progressPercent) > 0
                  ? "IN_PROGRESS"
                  : current.status,
            }
          : current,
      );
      setProgressError(false);
    } catch {
      setProgressError(true);
    }
  }, []);

  const videoId = assignment?.course.youtubeVideoId;
  useEffect(() => {
    if (!videoId || !playerHost.current || player.current) return;
    let interval = 0;
    let cancelled = false;
    const createPlayer = () => {
      if (cancelled || !window.YT || !playerHost.current || player.current)
        return;
      player.current = new window.YT.Player(playerHost.current, {
        videoId,
        playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
        events: {
          onReady: () => {
            interval = window.setInterval(() => void sendHeartbeat(), 7_000);
          },
        },
      });
    };
    if (window.YT?.Player) createPlayer();
    else {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        previous?.();
        createPlayer();
      };
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        document.head.appendChild(script);
      }
    }
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      player.current?.destroy();
      player.current = null;
    };
  }, [sendHeartbeat, videoId]);

  const choose = (questionId: number, optionIndex: number) => {
    if (!attempt) return;
    const next = { ...answers, [questionId]: optionIndex };
    setAnswers(next);
    window.localStorage.setItem(
      `training-attempt-${attempt.attemptId}`,
      JSON.stringify(next),
    );
  };

  const confirmAcknowledgement = async () => {
    if (!acknowledged) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/training/acknowledge", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось сохранить подтверждение");
    else await load();
    setBusy(false);
  };

  const startQuiz = async () => {
    setBusy(true);
    setError("");
    const response = await fetch("/api/training/attempts", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось открыть тест");
    else {
      const nextAttempt = body as Attempt;
      setAttempt(nextAttempt);
      setResult(null);
      const saved = window.localStorage.getItem(
        `training-attempt-${nextAttempt.attemptId}`,
      );
      if (saved) {
        try {
          setAnswers(JSON.parse(saved) as Record<number, number>);
        } catch {
          window.localStorage.removeItem(
            `training-attempt-${nextAttempt.attemptId}`,
          );
          setAnswers({});
        }
      } else setAnswers({});
    }
    setBusy(false);
  };

  const submitQuiz = async () => {
    if (!attempt || Object.keys(answers).length !== attempt.questions.length) {
      setError("Ответьте на все вопросы");
      return;
    }
    setBusy(true);
    setError("");
    const response = await fetch(
      `/api/training/attempts/${attempt.attemptId}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: attempt.questions.map((question) => ({
            questionId: question.id,
            optionIndex: answers[question.id],
          })),
        }),
      },
    );
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось отправить тест");
    else {
      setResult(body as Result);
      window.localStorage.removeItem(`training-attempt-${attempt.attemptId}`);
      await load();
    }
    setBusy(false);
  };

  if (loading && !assignment)
    return <main className="p-4 text-slate-300 md:p-8">Загрузка обучения…</main>;
  if (!assignment)
    return (
      <main className="p-4 md:p-8">
        <div className="rounded-2xl border border-red-800 bg-red-950/30 p-5 text-red-200">
          <p>{error || "Обучение не назначено"}</p>
          <button onClick={() => void load()} className="mt-3 min-h-11 rounded-xl bg-red-800 px-4">Повторить</button>
        </div>
      </main>
    );

  const progress = Math.min(100, Math.round(assignment.progressPercent));
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 overflow-x-hidden p-4 pb-24 md:p-8">
      <header>
        <p className="text-sm font-medium text-blue-300">Обязательное обучение</p>
        <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">{assignment.course.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{assignment.course.description}</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-200">{error}</div>}
      {progressError && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-amber-100">
          <span>Не удалось сохранить прогресс</span>
          <button onClick={() => void sendHeartbeat()} className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold">Повторить</button>
        </div>
      )}

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-400">Статус</p>
            <p className="mt-1 font-semibold text-white">{statusNames[assignment.status]}</p>
          </div>
          <div className="text-right">
            <p className="text-sm text-slate-400">Просмотрено</p>
            <p className="mt-1 text-2xl font-bold text-blue-300">{progress}%</p>
          </div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800" aria-label={`Прогресс просмотра ${progress}%`}>
          <div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-800 bg-black">
        <div className="aspect-video w-full" aria-label="Видео курса">
          <div ref={playerHost} className="h-full w-full" />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-white">Подтверждение просмотра</h2>
        {assignment.acknowledgedAt ? (
          <p className="mt-3 flex items-start gap-2 text-emerald-300"><CheckCircle2 className="mt-0.5 shrink-0" size={20} /> Ознакомление подтверждено.</p>
        ) : assignment.canAcknowledge ? (
          <div className="mt-3 space-y-3">
            <label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-700 p-3 text-sm text-slate-200">
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0" />
              Подтверждаю, что полностью ознакомился с обучающим видео и понял порядок выполнения замера лестницы.
            </label>
            <button disabled={!acknowledged || busy} onClick={() => void confirmAcknowledgement()} className="min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50">Сохранить подтверждение</button>
          </div>
        ) : (
          <p className="mt-3 flex items-start gap-2 text-slate-400"><CircleAlert className="mt-0.5 shrink-0" size={20} /> Доступно после фактического просмотра минимум {assignment.course.requiredCoverage}% видео.</p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-white">Проверочный тест</h2>
            <p className="mt-1 text-sm text-slate-400">{assignment.course.questionsCount} вопросов · проходной результат 12 из 15 ({assignment.course.passScorePercent}%)</p>
          </div>
          {!attempt && (
            <button disabled={!assignment.canStartQuiz || busy} onClick={() => void startQuiz()} className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"><PlayCircle size={19} /> {assignment.attemptsCount ? "Пройти ещё раз" : "Пройти тест"}</button>
          )}
        </div>
        {!assignment.canStartQuiz && !attempt && <p className="mt-4 rounded-xl bg-slate-900 p-4 text-sm text-slate-400">Тест откроется после просмотра 90% видео и подтверждения ознакомления.</p>}

        {attempt && !result && (
          <div className="mt-6 space-y-5">
            {attempt.questions.map((question) => (
              <fieldset key={question.id} className="min-w-0 rounded-xl border border-slate-700 p-4">
                <legend className="max-w-full px-2 font-semibold text-white">{question.position}. {question.question}</legend>
                <div className="mt-3 grid gap-2">
                  {question.options.map((option, index) => (
                    <label key={option} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${answers[question.id] === index ? "border-blue-500 bg-blue-950/40 text-white" : "border-slate-700 text-slate-300"}`}>
                      <input type="radio" name={`question-${question.id}`} checked={answers[question.id] === index} onChange={() => choose(question.id, index)} className="mt-0.5 size-5 shrink-0" />
                      <span>{String.fromCharCode(65 + index)}. {option}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            <button disabled={busy || Object.keys(answers).length !== attempt.questions.length} onClick={() => void submitQuiz()} className="min-h-14 w-full rounded-xl bg-blue-600 px-5 text-lg font-semibold disabled:opacity-50">Отправить ответы</button>
          </div>
        )}

        {result && (
          <div className={`mt-6 rounded-2xl border p-5 ${result.passed ? "border-emerald-700 bg-emerald-950/30" : "border-amber-700 bg-amber-950/30"}`}>
            <h3 className="text-xl font-bold text-white">Ваш результат: {result.score} из {result.total}</h3>
            <p className="mt-1 text-3xl font-bold text-white">{result.percent}%</p>
            <p className="mt-2 font-semibold text-white">{result.passed ? "Обучение пройдено" : "Для прохождения необходимо минимум 12 правильных ответов."}</p>
            <div className="mt-4 space-y-2 text-sm">
              {result.review.map((item) => (
                <div key={item.position} className="rounded-lg bg-black/20 p-3 text-slate-200">Вопрос {item.position}: {item.correct ? "правильно" : "неправильно"}. {item.explanation}</div>
              ))}
            </div>
            <button onClick={() => { setAttempt(null); setResult(null); setAnswers({}); }} className="mt-4 min-h-12 rounded-xl bg-slate-800 px-5 font-semibold">{result.passed ? "Закрыть результат" : "Пройти ещё раз"}</button>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-white">История попыток</h2>
        {assignment.attempts.length ? (
          <div className="mt-3 space-y-2">
            {assignment.attempts.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 p-3 text-sm">
                <span className="text-slate-300">{new Date(item.completedAt ?? item.startedAt).toLocaleString("ru-RU")}</span>
                <b className={item.status === "PASSED" ? "text-emerald-300" : "text-amber-300"}>{item.score ?? 0} из 15 · {Math.round(item.percent ?? 0)}% · {item.status === "PASSED" ? "PASS" : "FAIL"}</b>
              </div>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-slate-400">Попыток пока нет.</p>}
      </section>
    </main>
  );
}
