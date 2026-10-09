"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, PlayCircle } from "lucide-react";

import ChatGptOfficeAccessCard from "@/components/training/ChatGptOfficeAccessCard";
import { preferredTrainingLessonKey } from "@/lib/training-navigation";
import { trainingVideoErrorMessage } from "@/lib/training-video";

type AttemptHistory = { id: number; score: number | null; percent: number | null; status: string; startedAt: string; completedAt: string | null; lessonKey: string | null; lessonTitle: string };
type Lesson = { key: string; title: string; description: string; youtubeVideoId: string; progressPercent: number; questionsCount: number; videoCompleted: boolean; testRequired: boolean; quizPassed: boolean; quizInProgress: boolean; quizStatus: "NOT_REQUIRED" | "NOT_STARTED" | "IN_PROGRESS" | "FAILED" | "PASSED"; lessonCompleted: boolean; quizAttempts: number; quizBestPercent: number; canStartQuiz: boolean };
type KnowledgeSection = { title: string; items: readonly string[] };
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
  passedLessonsCount: number;
  lessonsCount: number;
  course: {
    version: number;
    title: string;
    description: string;
    youtubeVideoId: string;
    lessons: Lesson[];
    passScorePercent: number;
    requiredCoverage: number;
    questionsCount: number;
  };
  knowledge: KnowledgeSection[];
  attempts: AttemptHistory[];
};
type Question = { id: number; position: number; question: string; options: string[] };
type Attempt = { attemptId: number; startedAt: string; lessonKey: string; lessonTitle: string; questions: Question[] };
type Result = {
  score: number;
  total: number;
  percent: number;
  passed: boolean;
  lessonKey: string;
  lessonTitle: string;
  allLessonQuizzesPassed: boolean;
  review: Array<{ position: number; correct: boolean; correctOption: number; explanation: string }>;
};
type YouTubePlayer = { getCurrentTime: () => number; getDuration: () => number; getPlayerState: () => number; destroy: () => void };
type YouTubeApi = {
  Player: new (element: HTMLElement, options: { videoId: string; playerVars: Record<string, number>; events: { onReady: () => void; onStateChange: (event: { data: number }) => void; onError: (event: { data: number }) => void } }) => YouTubePlayer;
};
type HeartbeatTarget = { lessonKey: string; player: YouTubePlayer; playerState?: string };

declare global {
  interface Window { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void }
}

const statusNames: Record<Assignment["status"], string> = {
  NOT_STARTED: "Не начато",
  IN_PROGRESS: "В процессе",
  READY_FOR_TEST: "Все тесты пройдены",
  FAILED: "Тест не пройден",
  PASSED: "Обучение пройдено",
};
const playerStates: Record<number, string> = { 1: "PLAYING", 2: "PAUSED", 0: "ENDED", 3: "BUFFERING", 5: "CUED", [-1]: "UNSTARTED" };

function onYouTubeReady(callback: () => void) {
  const previous = window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady = () => { previous?.(); callback(); };
}

function lessonStatusLabel(lesson: Lesson, requiredCoverage: number) {
  if (lesson.lessonCompleted) return lesson.testRequired ? "Видео и тест пройдены" : "Видео просмотрено — урок завершён";
  if (!lesson.videoCompleted) return `Сначала просмотрите ${requiredCoverage}% видео`;
  if (lesson.quizStatus === "IN_PROGRESS") return "Тест начат — продолжите";
  if (lesson.quizStatus === "FAILED") return "Тест не пройден — повторите";
  return "Видео просмотрено — тест доступен";
}

export default function TrainingWorkspace() {
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [selectedLessonKey, setSelectedLessonKey] = useState("");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [result, setResult] = useState<Result | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progressError, setProgressError] = useState(false);
  const [videoError, setVideoError] = useState("");
  const [playerRetry, setPlayerRetry] = useState(0);
  const playerContainer = useRef<HTMLDivElement>(null);
  const quizSection = useRef<HTMLElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const heartbeatQueues = useRef(new Map<string, Promise<void>>());
  const assignmentRef = useRef<Assignment | null>(null);
  const selectedLessonRef = useRef("");

  useEffect(() => { assignmentRef.current = assignment; }, [assignment]);
  useEffect(() => { selectedLessonRef.current = selectedLessonKey; }, [selectedLessonKey]);

  useEffect(() => {
    if (!assignment || !selectedLessonKey) return;
    window.localStorage.setItem(`training-last-lesson-${assignment.id}`, selectedLessonKey);
    const url = new URL(window.location.href);
    if (url.searchParams.get("lesson") === selectedLessonKey) return;
    url.searchParams.set("lesson", selectedLessonKey);
    window.history.replaceState(window.history.state, "", url);
  }, [assignment, selectedLessonKey]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/training", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) setError(body.error ?? "Не удалось загрузить обучение");
      else {
        const next = body as Assignment;
        const requestedLesson = new URL(window.location.href).searchParams.get("lesson") ?? "";
        const storedLesson = window.localStorage.getItem(`training-last-lesson-${next.id}`) ?? "";
        setAssignment(next);
        setSelectedLessonKey((current) =>
          preferredTrainingLessonKey(
            next.course.lessons,
            current || requestedLesson || storedLesson,
          ),
        );
        setError("");
      }
    } catch {
      setError("Не удалось загрузить обучение. Проверьте соединение и повторите попытку.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const sendHeartbeat = useCallback((target?: HeartbeatTarget) => {
    const currentAssignment = assignmentRef.current;
    const targetPlayer = target?.player ?? player.current;
    const lessonKey = target?.lessonKey ?? selectedLessonRef.current;
    if (!targetPlayer || !currentAssignment || !lessonKey) return Promise.resolve();
    const duration = targetPlayer.getDuration();
    if (!duration) return Promise.resolve();
    const payload = {
      lessonKey,
      currentTime: targetPlayer.getCurrentTime(),
      duration,
      playerState: target?.playerState ?? playerStates[targetPlayer.getPlayerState()] ?? "UNKNOWN",
      courseVersion: currentAssignment.course.version,
    };
    const previous = heartbeatQueues.current.get(lessonKey) ?? Promise.resolve();
    const queued = previous.then(async () => {
      try {
        const response = await fetch("/api/training/heartbeat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error ?? "heartbeat failed");
        const lessonProgress = new Map<string, number>(
          Array.isArray(body.lessons)
            ? body.lessons.map((item: { key: string; progressPercent: number }) => [item.key, Number(item.progressPercent)])
            : [],
        );
        setAssignment((current) => {
          if (!current) return current;
          const lessons = current.course.lessons.map((lesson) => {
            const responseLesson = lesson.key === body.lessonKey;
            const videoCompleted = responseLesson
              ? Boolean(body.videoCompleted ?? body.canStartQuiz)
              : lesson.videoCompleted;
            return {
              ...lesson,
              progressPercent: lessonProgress.get(lesson.key) ?? lesson.progressPercent,
              videoCompleted,
              lessonCompleted: videoCompleted && (!lesson.testRequired || lesson.quizPassed),
              canStartQuiz: responseLesson
                ? Boolean(body.canStartQuiz) && !lesson.quizPassed
                : lesson.canStartQuiz,
            };
          });
          return {
            ...current,
            progressPercent: Number(body.progressPercent ?? current.progressPercent),
            canAcknowledge: current.canAcknowledge,
            canStartQuiz: lessons.some((lesson) => lesson.canStartQuiz),
            status: current.status === "NOT_STARTED" && Number(body.progressPercent) > 0 ? "IN_PROGRESS" : current.status,
            course: { ...current.course, lessons },
          };
        });
        setProgressError(false);
      } catch {
        setProgressError(true);
      }
    });
    heartbeatQueues.current.set(lessonKey, queued);
    void queued.then(() => {
      if (heartbeatQueues.current.get(lessonKey) === queued)
        heartbeatQueues.current.delete(lessonKey);
    });
    return queued;
  }, []);

  const selectedLesson = assignment?.course.lessons.find((lesson) => lesson.key === selectedLessonKey);
  const playerLessonKey = selectedLesson?.key ?? "";
  const videoId = selectedLesson?.youtubeVideoId;
  const displayedVideoError = selectedLesson && !videoId
    ? "Видео для этого урока пока не настроено. Сообщите директору."
    : videoError;
  useEffect(() => {
    const container = playerContainer.current;
    if (!container) return;
    container.replaceChildren();
    if (!videoId) return;
    let interval = 0;
    let readyTimeout = 0;
    let cancelled = false;
    let ready = false;
    let createdPlayer: YouTubePlayer | null = null;
    const startHeartbeatInterval = () => {
      if (interval || !createdPlayer) return;
      interval = window.setInterval(() => {
        if (createdPlayer)
          void sendHeartbeat({ lessonKey: playerLessonKey, player: createdPlayer });
      }, 7_000);
    };
    const createPlayer = () => {
      if (cancelled || !window.YT || player.current) return;
      const host = document.createElement("div");
      host.dataset.trainingVideoId = videoId;
      container.replaceChildren(host);
      try {
        createdPlayer = new window.YT.Player(host, {
          videoId,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
          events: {
            onReady: () => {
              if (cancelled) return;
              ready = true;
              window.clearTimeout(readyTimeout);
              setVideoError("");
              startHeartbeatInterval();
            },
            onStateChange: (event) => {
              if (cancelled || !createdPlayer) return;
              if (event.data === 0) {
                window.clearInterval(interval);
                interval = 0;
                void sendHeartbeat({
                  lessonKey: playerLessonKey,
                  player: createdPlayer,
                  playerState: "ENDED",
                });
              } else if (event.data === 1) {
                startHeartbeatInterval();
              }
            },
            onError: (event) => {
              if (cancelled) return;
              window.clearInterval(interval);
              setVideoError(trainingVideoErrorMessage(event.data));
            },
          },
        });
        player.current = createdPlayer;
      } catch {
        setVideoError(trainingVideoErrorMessage());
      }
    };
    readyTimeout = window.setTimeout(() => {
      if (!cancelled && !ready) setVideoError(trainingVideoErrorMessage());
    }, 15_000);
    if (window.YT?.Player) createPlayer();
    else {
      onYouTubeReady(createPlayer);
      let script = document.querySelector<HTMLScriptElement>('script[src="https://www.youtube.com/iframe_api"]');
      const handleScriptError = () => {
        if (!cancelled) setVideoError(trainingVideoErrorMessage());
        script?.remove();
      };
      if (!script) {
        script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        document.head.appendChild(script);
      }
      script.addEventListener("error", handleScriptError, { once: true });
    }
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.clearTimeout(readyTimeout);
      try { createdPlayer?.destroy(); } catch { /* The iframe may already be gone. */ }
      if (player.current === createdPlayer) player.current = null;
      container.replaceChildren();
    };
  }, [playerLessonKey, playerRetry, sendHeartbeat, videoId]);

  const selectLesson = (lessonKey: string) => {
    if (lessonKey === selectedLessonKey) return;
    const currentPlayer = player.current;
    const currentLessonKey = selectedLessonRef.current;
    if (currentPlayer && currentLessonKey)
      void sendHeartbeat({ lessonKey: currentLessonKey, player: currentPlayer });
    setSelectedLessonKey(lessonKey);
    setAttempt(null);
    setResult(null);
    setAnswers({});
    setError("");
    setVideoError("");
  };

  const goToQuiz = () => {
    quizSection.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.requestAnimationFrame(() => quizSection.current?.focus({ preventScroll: true }));
  };

  const choose = (questionId: number, optionIndex: number) => {
    if (!attempt) return;
    const next = { ...answers, [questionId]: optionIndex };
    setAnswers(next);
    window.localStorage.setItem(`training-attempt-${attempt.attemptId}`, JSON.stringify(next));
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
    if (!selectedLessonKey) return;
    setBusy(true);
    setError("");
    const response = await fetch("/api/training/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lessonKey: selectedLessonKey }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось открыть тест");
    else {
      const nextAttempt = body as Attempt;
      setAttempt(nextAttempt);
      setAssignment((current) => current ? {
        ...current,
        course: {
          ...current.course,
          lessons: current.course.lessons.map((lesson) => lesson.key === nextAttempt.lessonKey
            ? { ...lesson, quizInProgress: true, quizStatus: "IN_PROGRESS" }
            : lesson),
        },
      } : current);
      setResult(null);
      const saved = window.localStorage.getItem(`training-attempt-${nextAttempt.attemptId}`);
      if (saved) {
        try { setAnswers(JSON.parse(saved) as Record<number, number>); }
        catch { window.localStorage.removeItem(`training-attempt-${nextAttempt.attemptId}`); setAnswers({}); }
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
    const response = await fetch(`/api/training/attempts/${attempt.attemptId}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: attempt.questions.map((question) => ({ questionId: question.id, optionIndex: answers[question.id] })) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? "Не удалось отправить тест");
    else {
      setResult(body as Result);
      window.localStorage.removeItem(`training-attempt-${attempt.attemptId}`);
      await load();
    }
    setBusy(false);
  };

  if (loading && !assignment) return <main className="p-4 text-slate-300 md:p-8">Загрузка обучения…</main>;
  if (!assignment) return (
    <main className="p-4 md:p-8"><div className="rounded-2xl border border-red-800 bg-red-950/30 p-5 text-red-200"><p>{error || "Обучение не назначено"}</p><button onClick={() => void load()} className="mt-3 min-h-11 rounded-xl bg-red-800 px-4">Повторить</button></div></main>
  );

  const progress = Math.min(100, Math.round(assignment.progressPercent));
  const requiredCorrect = Math.ceil(((attempt?.questions.length ?? selectedLesson?.questionsCount ?? 0) * assignment.course.passScorePercent) / 100);
  const selectedLessonIndex = assignment.course.lessons.findIndex(
    (lesson) => lesson.key === selectedLessonKey,
  );
  const previousLesson = selectedLessonIndex > 0
    ? assignment.course.lessons[selectedLessonIndex - 1]
    : null;
  const nextLesson = selectedLessonIndex >= 0 && selectedLessonIndex < assignment.course.lessons.length - 1
    ? assignment.course.lessons[selectedLessonIndex + 1]
    : null;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 overflow-x-hidden p-4 pb-24 md:p-8">
      <header>
        <p className="text-sm font-medium text-blue-300">Обязательное обучение</p>
        <h1 className="mt-1 text-2xl font-bold text-white md:text-3xl">{assignment.course.title}</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-400">{assignment.course.description}</p>
      </header>

      {error && <div role="alert" className="rounded-xl border border-red-800 bg-red-950/30 p-4 text-red-200">{error}</div>}
      {progressError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-700 bg-amber-950/30 p-4 text-amber-100"><span>Не удалось сохранить прогресс текущего урока</span><button onClick={() => void sendHeartbeat()} className="min-h-11 rounded-xl bg-amber-700 px-4 font-semibold">Повторить</button></div>}

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm text-slate-400">Статус</p><p className="mt-1 font-semibold text-white">{statusNames[assignment.status]}</p></div>
          <div className="text-right"><p className="text-sm text-slate-400">Общий прогресс</p><p className="mt-1 text-2xl font-bold text-blue-300">{progress}%</p></div>
        </div>
        <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-800" aria-label={`Прогресс просмотра ${progress}%`}><div className="h-full rounded-full bg-blue-500 transition-[width]" style={{ width: `${progress}%` }} /></div>
        <p className="mt-3 text-xs text-slate-500">После просмотра минимум {assignment.course.requiredCoverage}% каждого видео откроется отдельный тест по этому уроку. Пройдено тестов: {assignment.passedLessonsCount}/{assignment.lessonsCount}.</p>
      </section>

      <ChatGptOfficeAccessCard />

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <h2 className="text-xl font-semibold text-white">Краткая база знаний</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {assignment.knowledge.map((section) => <article key={section.title} className="rounded-xl bg-slate-900 p-4"><h3 className="font-semibold text-blue-200">{section.title}</h3><ul className="mt-2 space-y-2 pl-5 text-sm text-slate-300">{section.items.map((item) => <li key={item} className="list-disc">{item}</li>)}</ul></article>)}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-2 rounded-2xl border border-slate-800 bg-[#101827] p-3">
          <h2 className="px-2 py-1 text-lg font-semibold text-white">Видеоуроки</h2>
          {assignment.course.lessons.map((lesson, index) => {
            const active = lesson.key === selectedLessonKey;
            return <button key={lesson.key} onClick={() => selectLesson(lesson.key)} className={`w-full rounded-xl border p-3 text-left transition ${active ? "border-blue-500 bg-blue-950/40" : "border-slate-800 bg-slate-900 hover:border-slate-600"}`}><span className="flex items-start justify-between gap-3"><span className="text-sm font-semibold text-white">{index + 1}. {lesson.title}</span>{lesson.lessonCompleted ? <CheckCircle2 className="shrink-0 text-emerald-400" size={19} /> : <span className="shrink-0 text-xs font-bold text-slate-400">{Math.round(lesson.progressPercent)}%</span>}</span><span className={`mt-2 block text-xs ${lesson.lessonCompleted ? "text-emerald-300" : lesson.videoCompleted ? "text-blue-300" : "text-slate-500"}`}>{lessonStatusLabel(lesson, assignment.course.requiredCoverage)}</span></button>;
          })}
        </div>
        <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-[#101827]">
          <div className="relative aspect-video w-full bg-black" aria-label="Видео курса"><div ref={playerContainer} className="h-full w-full" />{displayedVideoError && <div role="alert" className="absolute inset-0 grid place-items-center bg-slate-950 p-6 text-center text-sm text-amber-200"><div><CircleAlert className="mx-auto mb-3" /><p>{displayedVideoError}</p>{videoId && <button type="button" onClick={() => { setVideoError(""); setPlayerRetry((current) => current + 1); }} className="mt-4 min-h-11 rounded-xl bg-slate-800 px-4 font-semibold text-white">Повторить загрузку</button>}</div></div>}</div>
          {selectedLesson && <div className="p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-white">{selectedLesson.title}</h2><p className="mt-1 text-sm text-slate-400">{selectedLesson.description}</p></div><b className="rounded-lg bg-slate-900 px-3 py-2 text-blue-200">{Math.round(selectedLesson.progressPercent)}%</b></div>
            {selectedLesson.videoCompleted && !selectedLesson.quizPassed && selectedLesson.testRequired && <div role="status" className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950/30 p-4"><p className="flex items-center gap-2 font-semibold text-emerald-200"><CheckCircle2 size={20} /> Видео просмотрено</p><p className="mt-1 text-sm text-emerald-100/80">Теперь пройдите тест по этому уроку.</p><button type="button" onClick={goToQuiz} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-700 px-4 font-semibold text-white"><PlayCircle size={18} />Перейти к тесту</button></div>}
            {selectedLesson.lessonCompleted && !selectedLesson.testRequired && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl border border-emerald-700 bg-emerald-950/30 p-4 text-sm font-semibold text-emerald-200"><CheckCircle2 size={20} /> Видео просмотрено. Для этого урока тест не требуется.</p>}
            <div className="mt-4 flex flex-wrap justify-between gap-3"><button type="button" disabled={!previousLesson} onClick={() => previousLesson && selectLesson(previousLesson.key)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={18} />Предыдущий урок</button><button type="button" disabled={!nextLesson} onClick={() => nextLesson && selectLesson(nextLesson.key)} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-700 px-4 text-sm font-semibold text-slate-200 disabled:cursor-not-allowed disabled:opacity-40">Следующий урок<ChevronRight size={18} /></button></div>
          </div>}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-white">Подтверждение ознакомления</h2>
        {assignment.acknowledgedAt ? <p className="mt-3 flex items-start gap-2 text-emerald-300"><CheckCircle2 className="mt-0.5 shrink-0" size={20} /> Ознакомление со всеми материалами подтверждено.</p>
          : assignment.canAcknowledge ? <div className="mt-3 space-y-3"><label className="flex min-h-12 items-start gap-3 rounded-xl border border-slate-700 p-3 text-sm text-slate-200"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0" />Подтверждаю, что ознакомился со всеми уроками и понял стандарты ALTYN SAPA, порядок замера и передачи результата.</label><button disabled={!acknowledged || busy} onClick={() => void confirmAcknowledgement()} className="min-h-12 w-full rounded-xl bg-blue-600 px-4 font-semibold disabled:opacity-50">Сохранить подтверждение</button></div>
          : <p className="mt-3 flex items-start gap-2 text-slate-400"><CircleAlert className="mt-0.5 shrink-0" size={20} /> Доступно после просмотра и успешного теста по каждому из {assignment.lessonsCount} видео.</p>}
      </section>

      <section ref={quizSection} tabIndex={-1} className="scroll-mt-4 rounded-2xl border border-slate-800 bg-[#101827] p-4 outline-none md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-semibold text-white">Тест по выбранному видео</h2><p className="mt-1 text-sm text-slate-400">{selectedLesson ? `${selectedLesson.title} · ${selectedLesson.questionsCount} вопросов · нужно ${requiredCorrect} правильных` : "Выберите видео"}</p></div>
          {!attempt && selectedLesson?.testRequired && !selectedLesson.quizPassed && <button disabled={!selectedLesson.canStartQuiz || busy} onClick={() => void startQuiz()} className="flex min-h-12 items-center gap-2 rounded-xl bg-emerald-700 px-5 font-semibold disabled:cursor-not-allowed disabled:opacity-40"><PlayCircle size={19} /> {selectedLesson.quizInProgress ? "Продолжить тест" : selectedLesson.quizAttempts ? "Пройти ещё раз" : "Пройти тест по видео"}</button>}
        </div>
        {selectedLesson?.quizPassed && !attempt && <p className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-950/30 p-4 text-sm text-emerald-300"><CheckCircle2 size={20} /> Тест по этому видео пройден. Выберите следующий урок.</p>}
        {selectedLesson?.testRequired && !selectedLesson.quizPassed && !selectedLesson.canStartQuiz && !attempt && <p className="mt-4 rounded-xl bg-slate-900 p-4 text-sm text-slate-400">Тест откроется после фактического просмотра минимум {assignment.course.requiredCoverage}% этого видео.</p>}
        {selectedLesson && !selectedLesson.testRequired && !attempt && <p className="mt-4 rounded-xl bg-slate-900 p-4 text-sm text-slate-300">Для этого урока тест не предусмотрен. После просмотра видео урок завершится автоматически.</p>}

        {attempt && !result && <div className="mt-6 space-y-5">
          {attempt.questions.map((question) => <fieldset key={question.id} className="min-w-0 rounded-xl border border-slate-700 p-4"><legend className="max-w-full px-2 font-semibold text-white">{question.position}. {question.question}</legend><div className="mt-3 grid gap-2">{question.options.map((option, index) => <label key={option} className={`flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm ${answers[question.id] === index ? "border-blue-500 bg-blue-950/40 text-white" : "border-slate-700 text-slate-300"}`}><input type="radio" name={`question-${question.id}`} checked={answers[question.id] === index} onChange={() => choose(question.id, index)} className="mt-0.5 size-5 shrink-0" /><span>{String.fromCharCode(65 + index)}. {option}</span></label>)}</div></fieldset>)}
          <button disabled={busy || Object.keys(answers).length !== attempt.questions.length} onClick={() => void submitQuiz()} className="min-h-14 w-full rounded-xl bg-blue-600 px-5 text-lg font-semibold disabled:opacity-50">Отправить ответы</button>
        </div>}

        {result && <div className={`mt-6 rounded-2xl border p-5 ${result.passed ? "border-emerald-700 bg-emerald-950/30" : "border-amber-700 bg-amber-950/30"}`}><h3 className="text-xl font-bold text-white">{result.lessonTitle}: {result.score} из {result.total}</h3><p className="mt-1 text-3xl font-bold text-white">{result.percent}%</p><p className="mt-2 font-semibold text-white">{result.passed ? result.allLessonQuizzesPassed ? "Все тесты пройдены. Подтвердите ознакомление ниже." : "Тест по видео пройден. Переходите к следующему уроку." : `Для прохождения необходимо минимум ${requiredCorrect} правильных ответов.`}</p><div className="mt-4 space-y-2 text-sm">{result.review.map((item) => <div key={item.position} className="rounded-lg bg-black/20 p-3 text-slate-200">Вопрос {item.position}: {item.correct ? "правильно" : "неправильно"}. {item.explanation}</div>)}</div><button onClick={() => { setAttempt(null); setResult(null); setAnswers({}); }} className="mt-4 min-h-12 rounded-xl bg-slate-800 px-5 font-semibold">{result.passed ? "Закрыть результат" : "Пройти ещё раз"}</button></div>}
      </section>

      <section className="rounded-2xl border border-slate-800 bg-[#101827] p-4 md:p-6">
        <h2 className="text-lg font-semibold text-white">История попыток</h2>
        {assignment.attempts.length ? <div className="mt-3 space-y-2">{assignment.attempts.map((item) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-900 p-3 text-sm"><span className="text-slate-300">{item.lessonTitle} · {new Date(item.completedAt ?? item.startedAt).toLocaleString("ru-RU")}</span><b className={item.status === "PASSED" ? "text-emerald-300" : "text-amber-300"}>{Math.round(item.percent ?? 0)}% · {item.status === "PASSED" ? "PASS" : "FAIL"}</b></div>)}</div> : <p className="mt-3 text-sm text-slate-400">Попыток пока нет.</p>}
      </section>
    </main>
  );
}
