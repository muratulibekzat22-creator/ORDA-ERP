import {
  Prisma,
  Role,
  TrainingAttemptStatus,
  TrainingAuditAction,
  TrainingStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  MEASURER_KNOWLEDGE,
  MEASURER_QUESTIONS,
} from "@/lib/training-course";
import {
  acceptedHeartbeatRange,
  mergeWatchedRanges,
  parseWatchedRanges,
  watchedPercent,
} from "@/lib/training-progress";
import { trainingLessonCompletionState } from "@/lib/training-navigation";
import { normalizeYouTubeVideoId } from "@/lib/training-video";
import { productionLog } from "@/lib/observability";

type Db = Prisma.TransactionClient;
type Heartbeat = {
  lessonKey: string;
  currentTime: number;
  duration: number;
  playerState: string;
  courseVersion: number;
};
type SubmittedAnswer = { questionId: number; optionIndex: number };
type CourseLesson = {
  key: string;
  title: string;
  description: string;
  youtubeVideoId: string;
};
type StoredLessonProgress = {
  watchedRanges: [number, number][];
  videoDuration: number | null;
  lastVideoTime: number | null;
  lastHeartbeatAt: string | null;
  progressPercent: number;
};
type LessonProgressMap = Record<string, StoredLessonProgress>;

const lessonKeyByQuestionPosition = new Map(
  MEASURER_QUESTIONS.map((question) => [question.position, question.lessonKey]),
);
const loggedInvalidVideoCourses = new Set<number>();

function attemptLessonKey(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const lessonKey = (value as Record<string, unknown>).lessonKey;
  return typeof lessonKey === "string" ? lessonKey : null;
}

function passedLessonKeys(
  attempts: Array<{ status: TrainingAttemptStatus; answers: Prisma.JsonValue | null }>,
  lessons: CourseLesson[],
  legacyCoursePassed = false,
) {
  if (legacyCoursePassed && !attempts.some((attempt) => attemptLessonKey(attempt.answers)))
    return new Set(lessons.map((lesson) => lesson.key));
  return new Set(
    attempts.flatMap((attempt) => {
      const lessonKey = attempt.status === TrainingAttemptStatus.PASSED
        ? attemptLessonKey(attempt.answers)
        : null;
      return lessonKey ? [lessonKey] : [];
    }),
  );
}

function lessonQuestionPositions(lessonKey: string) {
  return MEASURER_QUESTIONS
    .filter((question) => question.lessonKey === lessonKey)
    .map((question) => question.position);
}

function courseLessons(course: {
  videoLessons: Prisma.JsonValue | null;
  youtubeVideoId: string;
}): CourseLesson[] {
  if (Array.isArray(course.videoLessons)) {
    const seenKeys = new Set<string>();
    const lessons = course.videoLessons.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const lesson = value as Record<string, unknown>;
      if (
        typeof lesson.key !== "string" ||
        typeof lesson.title !== "string" ||
        typeof lesson.description !== "string"
      )
        return [];
      const key = lesson.key.trim();
      if (!key || seenKeys.has(key)) return [];
      seenKeys.add(key);
      return [
        {
          key,
          title: lesson.title.trim(),
          description: lesson.description.trim(),
          youtubeVideoId: normalizeYouTubeVideoId(lesson.youtubeVideoId),
        },
      ];
    });
    if (lessons.length) return lessons;
  }
  return [
    {
      key: "main",
      title: "Обучающее видео",
      description: "Обязательный видеоурок курса.",
      youtubeVideoId: normalizeYouTubeVideoId(course.youtubeVideoId),
    },
  ];
}

function parseLessonProgress(value: Prisma.JsonValue): LessonProgressMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, raw]) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
      const item = raw as Record<string, unknown>;
      const videoDuration =
        typeof item.videoDuration === "number" && Number.isFinite(item.videoDuration)
          ? item.videoDuration
          : null;
      const lastVideoTime =
        typeof item.lastVideoTime === "number" && Number.isFinite(item.lastVideoTime)
          ? item.lastVideoTime
          : null;
      const progressPercent =
        typeof item.progressPercent === "number" && Number.isFinite(item.progressPercent)
          ? Math.max(0, Math.min(100, item.progressPercent))
          : 0;
      return [[key, {
        watchedRanges: parseWatchedRanges(item.watchedRanges as Prisma.JsonValue),
        videoDuration,
        lastVideoTime,
        lastHeartbeatAt:
          typeof item.lastHeartbeatAt === "string" ? item.lastHeartbeatAt : null,
        progressPercent,
      } satisfies StoredLessonProgress]];
    }),
  );
}

function lessonStates(
  course: { videoLessons: Prisma.JsonValue | null; youtubeVideoId: string },
  assignment: {
    lessonProgress: Prisma.JsonValue;
    watchedRanges: Prisma.JsonValue;
    videoDuration: number | null;
    lastVideoTime: number | null;
    lastHeartbeatAt: Date | null;
    progressPercent: number;
  },
) {
  const lessons = courseLessons(course);
  const stored = parseLessonProgress(assignment.lessonProgress);
  if (lessons.length === 1 && lessons[0].key === "main" && !stored.main) {
    stored.main = {
      watchedRanges: parseWatchedRanges(assignment.watchedRanges),
      videoDuration: assignment.videoDuration,
      lastVideoTime: assignment.lastVideoTime,
      lastHeartbeatAt: assignment.lastHeartbeatAt?.toISOString() ?? null,
      progressPercent: assignment.progressPercent,
    };
  }
  const presented = lessons.map((lesson) => ({
    ...lesson,
    progressPercent: Math.round((stored[lesson.key]?.progressPercent ?? 0) * 10) / 10,
  }));
  return { lessons, stored, presented };
}

function hasRequiredLessonCoverage(
  lessons: CourseLesson[],
  stored: LessonProgressMap,
  requiredCoverage: number,
) {
  return lessons.every(
    (lesson) => (stored[lesson.key]?.progressPercent ?? 0) >= requiredCoverage,
  );
}

const activeCourse = (db: Db | typeof prisma) =>
  db.trainingCourse.findFirst({
    where: { targetRole: Role.MEASURER, active: true, mandatory: true },
    orderBy: { version: "desc" },
  });

export async function ensureCurrentMeasurerTraining(db: Db, userId: number) {
  const measurer = await db.user.findFirst({
    where: { id: userId, role: Role.MEASURER, active: true },
    select: { id: true },
  });
  if (!measurer) return null;
  const course = await activeCourse(db);
  if (!course) return null;
  return db.trainingAssignment.upsert({
    where: { courseId_userId: { courseId: course.id, userId } },
    update: {},
    create: {
      courseId: course.id,
      userId,
      audits: {
        create: {
          actorId: userId,
          action: TrainingAuditAction.ASSIGNED,
          metadata: { source: "ROLE_ASSIGNMENT" },
        },
      },
    },
  });
}

export async function hasTrainingClearance(db: Db, userId: number) {
  const course = await activeCourse(db);
  if (!course) return true;
  const assignment = await ensureCurrentMeasurerTraining(db, userId);
  return Boolean(
    assignment &&
      (assignment.status === TrainingStatus.PASSED ||
        (assignment.overrideExpiresAt && assignment.overrideExpiresAt > new Date())),
  );
}

export async function getMyTraining(userId: number) {
  const assignmentId = await prisma.$transaction(async (tx) =>
    (await ensureCurrentMeasurerTraining(tx, userId))?.id,
  );
  if (!assignmentId) throw new Error("TRAINING_NOT_FOUND");
  const assignment = await prisma.trainingAssignment.findUniqueOrThrow({
    where: { id: assignmentId },
    include: {
      course: {
        include: {
          _count: { select: { questions: true } },
          questions: { select: { position: true } },
        },
      },
      attempts: {
        select: {
          id: true,
          score: true,
          percent: true,
          status: true,
          answers: true,
          startedAt: true,
          completedAt: true,
        },
        orderBy: { startedAt: "desc" },
      },
    },
  });
  const progress = lessonStates(assignment.course, assignment);
  const hasCoverage = hasRequiredLessonCoverage(
    progress.lessons,
    progress.stored,
    assignment.course.requiredCoverage,
  );
  const completedAttempts = assignment.attempts.filter(
    (attempt) => attempt.completedAt !== null,
  );
  const passedKeys = passedLessonKeys(
    completedAttempts,
    progress.lessons,
    assignment.status === TrainingStatus.PASSED,
  );
  const lessonAttempts = new Map<string, typeof assignment.attempts>();
  for (const attempt of assignment.attempts) {
    const lessonKey = attemptLessonKey(attempt.answers);
    if (!lessonKey) continue;
    lessonAttempts.set(lessonKey, [...(lessonAttempts.get(lessonKey) ?? []), attempt]);
  }
  const lessons = progress.presented.map((lesson) => {
    const attempts = lessonAttempts.get(lesson.key) ?? [];
    const completed = attempts.filter((attempt) => attempt.completedAt !== null);
    const questionsCount = assignment.course.questions.filter(
      (question) => lessonKeyByQuestionPosition.get(question.position) === lesson.key,
    ).length;
    const quizPassed = passedKeys.has(lesson.key);
    const quizInProgress = attempts.some(
      (attempt) =>
        attempt.status === TrainingAttemptStatus.IN_PROGRESS &&
        attempt.startedAt.getTime() > Date.now() - 2 * 60 * 60 * 1000,
    );
    const completion = trainingLessonCompletionState({
      progressPercent: assignment.status === TrainingStatus.PASSED
        ? 100
        : (progress.stored[lesson.key]?.progressPercent ?? 0),
      requiredCoverage: assignment.course.requiredCoverage,
      questionsCount,
      quizPassed,
    });
    return {
      ...lesson,
      questionsCount,
      videoCompleted: completion.videoCompleted,
      testRequired: completion.testRequired,
      quizPassed,
      quizInProgress,
      quizStatus: !completion.testRequired
        ? "NOT_REQUIRED"
        : quizPassed
        ? "PASSED"
        : quizInProgress
          ? "IN_PROGRESS"
          : completed.some((attempt) => attempt.status === TrainingAttemptStatus.FAILED)
            ? "FAILED"
            : "NOT_STARTED",
      lessonCompleted: completion.lessonCompleted,
      quizAttempts: completed.length,
      quizBestPercent: Math.round(Math.max(0, ...completed.map((attempt) => attempt.percent ?? 0))),
      canStartQuiz: completion.testAvailable,
    };
  });
  if (
    lessons.some((lesson) => !lesson.youtubeVideoId) &&
    !loggedInvalidVideoCourses.has(assignment.course.id)
  ) {
    loggedInvalidVideoCourses.add(assignment.course.id);
    productionLog("error", "training.lesson_video_invalid", {
      route: "/api/training",
      method: "GET",
      reason: "COURSE_VIDEO_ID_INVALID",
    });
  }
  const allLessonQuizzesPassed =
    lessons.length > 0 && lessons.every(
      (lesson) => !lesson.testRequired || lesson.quizPassed,
    );
  return {
    id: assignment.id,
    status: assignment.status,
    progressPercent: Math.round(assignment.progressPercent * 10) / 10,
    acknowledgedAt: assignment.acknowledgedAt,
    attemptsCount: assignment.attemptsCount,
    bestScore: assignment.bestScore,
    bestPercent: assignment.bestPercent,
    passedAt: assignment.passedAt,
    lastViewedAt: assignment.lastViewedAt,
    overrideExpiresAt: assignment.overrideExpiresAt,
    course: {
      id: assignment.course.id,
      slug: assignment.course.slug,
      version: assignment.course.version,
      title: assignment.course.title,
      description: assignment.course.description,
      videoLanguage: assignment.course.videoLanguage,
      quizLanguage: assignment.course.quizLanguage,
      youtubeVideoId: assignment.course.youtubeVideoId,
      lessons,
      passScorePercent: assignment.course.passScorePercent,
      requiredCoverage: assignment.course.requiredCoverage,
      questionsCount: assignment.course._count.questions,
    },
    knowledge: MEASURER_KNOWLEDGE,
    passedLessonsCount: lessons.filter((lesson) => lesson.lessonCompleted).length,
    lessonsCount: lessons.length,
    attempts: completedAttempts.map(({ answers, ...attempt }) => {
      const lessonKey = attemptLessonKey(answers);
      return {
        ...attempt,
        lessonKey,
        lessonTitle: lessons.find((lesson) => lesson.key === lessonKey)?.title ?? "Общий тест",
      };
    }),
    canAcknowledge:
      hasCoverage && allLessonQuizzesPassed && !assignment.acknowledgedAt,
    canStartQuiz: lessons.some((lesson) => lesson.canStartQuiz),
  };
}

export async function recordTrainingHeartbeat(userId: number, input: Heartbeat) {
  if (
    !Number.isFinite(input.currentTime) ||
    !Number.isFinite(input.duration) ||
    input.currentTime < 0 ||
    input.duration < 30 ||
    input.duration > 28_800 ||
    input.currentTime > input.duration + 2 ||
    !Number.isInteger(input.courseVersion) ||
    typeof input.lessonKey !== "string"
  )
    throw new Error("INVALID_HEARTBEAT");

  return prisma.$transaction(async (tx) => {
    const assignment = await ensureCurrentMeasurerTraining(tx, userId);
    if (!assignment) throw new Error("TRAINING_NOT_FOUND");
    const course = await tx.trainingCourse.findUniqueOrThrow({
      where: { id: assignment.courseId },
    });
    if (course.version !== input.courseVersion)
      throw new Error("INVALID_HEARTBEAT");

    const progress = lessonStates(course, assignment);
    const lesson =
      progress.lessons.find((item) => item.key === input.lessonKey) ??
      (progress.lessons.length === 1 && !input.lessonKey
        ? progress.lessons[0]
        : null);
    if (!lesson) throw new Error("INVALID_HEARTBEAT");
    const current = progress.stored[lesson.key] ?? {
      watchedRanges: [],
      videoDuration: null,
      lastVideoTime: null,
      lastHeartbeatAt: null,
      progressPercent: 0,
    };

    const receivedAt = new Date();
    const stableDuration = current.videoDuration ?? input.duration;
    const durationChanged =
      current.videoDuration !== null &&
      Math.abs(input.duration - current.videoDuration) >
        Math.max(3, current.videoDuration * 0.02);
    const accepted = durationChanged
      ? null
      : acceptedHeartbeatRange({
          previousTime: current.lastVideoTime,
          previousAt: current.lastHeartbeatAt
            ? new Date(current.lastHeartbeatAt)
            : null,
          currentTime: input.currentTime,
          receivedAt,
          playerState: input.playerState,
        });
    const merged = mergeWatchedRanges(
      accepted ? [...current.watchedRanges, accepted] : current.watchedRanges,
      stableDuration,
    );
    const lessonProgressPercent = Math.max(
      current.progressPercent,
      watchedPercent(merged, stableDuration),
    );
    progress.stored[lesson.key] = {
      watchedRanges: merged,
      videoDuration: stableDuration,
      lastVideoTime: input.currentTime,
      lastHeartbeatAt: receivedAt.toISOString(),
      progressPercent: lessonProgressPercent,
    };
    const progressPercent =
      progress.lessons.reduce(
        (total, item) => total + (progress.stored[item.key]?.progressPercent ?? 0),
        0,
      ) / progress.lessons.length;
    const status =
      assignment.status === TrainingStatus.PASSED ||
      assignment.status === TrainingStatus.READY_FOR_TEST
        ? assignment.status
        : progressPercent > 0
          ? TrainingStatus.IN_PROGRESS
          : TrainingStatus.NOT_STARTED;
    const updated = await tx.trainingAssignment.update({
      where: { id: assignment.id },
      data: {
        watchedRanges: merged as Prisma.InputJsonValue,
        lessonProgress: progress.stored as unknown as Prisma.InputJsonValue,
        progressPercent,
        videoDuration: stableDuration,
        lastVideoTime: input.currentTime,
        lastHeartbeatAt: receivedAt,
        lastViewedAt: receivedAt,
        status,
      },
    });
    const completion = trainingLessonCompletionState({
      progressPercent: lessonProgressPercent,
      requiredCoverage: course.requiredCoverage,
      questionsCount: lessonQuestionPositions(lesson.key).length,
      quizPassed: false,
    });
    return {
      progressPercent: Math.round(updated.progressPercent * 10) / 10,
      lessonKey: lesson.key,
      lessonProgressPercent: Math.round(lessonProgressPercent * 10) / 10,
      lessons: progress.lessons.map((item) => ({
        key: item.key,
        progressPercent:
          Math.round((progress.stored[item.key]?.progressPercent ?? 0) * 10) / 10,
      })),
      canAcknowledge: false,
      videoCompleted: completion.videoCompleted,
      canStartQuiz: completion.testAvailable,
    };
  });
}

export async function acknowledgeTraining(userId: number) {
  return prisma.$transaction(async (tx) => {
    const assignment = await ensureCurrentMeasurerTraining(tx, userId);
    if (!assignment) throw new Error("TRAINING_NOT_FOUND");
    const course = await tx.trainingCourse.findUniqueOrThrow({
      where: { id: assignment.courseId },
    });
    const progress = lessonStates(course, assignment);
    if (
      !hasRequiredLessonCoverage(
        progress.lessons,
        progress.stored,
        course.requiredCoverage,
      )
    )
      throw new Error("ACKNOWLEDGEMENT_LOCKED");
    const completedAttempts = await tx.trainingAttempt.findMany({
      where: { assignmentId: assignment.id, completedAt: { not: null } },
      select: { status: true, answers: true },
    });
    const passedKeys = passedLessonKeys(
      completedAttempts,
      progress.lessons,
      assignment.status === TrainingStatus.PASSED,
    );
    if (!progress.lessons.every(
      (lesson) => !lessonQuestionPositions(lesson.key).length || passedKeys.has(lesson.key),
    ))
      throw new Error("ACKNOWLEDGEMENT_LOCKED");
    if (assignment.acknowledgedAt) return assignment;
    const now = new Date();
    const updated = await tx.trainingAssignment.update({
      where: { id: assignment.id },
      data: {
        acknowledgedAt: now,
        status: TrainingStatus.PASSED,
        passedAt: assignment.passedAt ?? now,
      },
    });
    await tx.trainingAudit.create({
      data: {
        assignmentId: assignment.id,
        actorId: userId,
        action: TrainingAuditAction.ACKNOWLEDGED,
        metadata: { courseVersion: course.version },
      },
    });
    return updated;
  });
}

export async function recordChatGptAccessReveal(userId: number) {
  return prisma.$transaction(async (tx) => {
    const assignment = await ensureCurrentMeasurerTraining(tx, userId);
    if (!assignment) throw new Error("TRAINING_NOT_FOUND");
    await tx.trainingAudit.create({
      data: {
        assignmentId: assignment.id,
        actorId: userId,
        action: TrainingAuditAction.CHATGPT_ACCESS_REVEALED,
        metadata: { purpose: "MEASUREMENT_3D", revealedAt: new Date() },
      },
    });
    return { assignmentId: assignment.id };
  });
}

const quizPayload = async (db: Db, courseId: number, positions: number[]) =>
  db.trainingQuestion.findMany({
    where: { courseId, position: { in: positions } },
    select: { id: true, position: true, question: true, options: true },
    orderBy: { position: "asc" },
  });

export async function startTrainingAttempt(userId: number, requestedLessonKey?: string) {
  return prisma.$transaction(async (tx) => {
    const assignment = await ensureCurrentMeasurerTraining(tx, userId);
    if (!assignment) throw new Error("TRAINING_NOT_FOUND");
    const course = await tx.trainingCourse.findUniqueOrThrow({
      where: { id: assignment.courseId },
    });
    const progress = lessonStates(course, assignment);
    const lessonKey = requestedLessonKey || (progress.lessons.length === 1 ? progress.lessons[0].key : "");
    const lesson = progress.lessons.find((item) => item.key === lessonKey);
    if (!lesson) throw new Error("INVALID_LESSON");
    if ((progress.stored[lesson.key]?.progressPercent ?? 0) < course.requiredCoverage)
      throw new Error("QUIZ_LOCKED");
    const positions = lessonQuestionPositions(lesson.key);
    if (!positions.length) throw new Error("QUIZ_NOT_CONFIGURED");
    const completedAttempts = await tx.trainingAttempt.findMany({
      where: { assignmentId: assignment.id, completedAt: { not: null } },
      select: { status: true, answers: true },
    });
    if (passedLessonKeys(completedAttempts, progress.lessons).has(lesson.key))
      throw new Error("LESSON_QUIZ_PASSED");
    const recentCandidates = await tx.trainingAttempt.findMany({
      where: {
        assignmentId: assignment.id,
        status: TrainingAttemptStatus.IN_PROGRESS,
        startedAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      orderBy: { startedAt: "desc" },
    });
    const recent = recentCandidates.find(
      (attempt) => attemptLessonKey(attempt.answers) === lesson.key,
    );
    const attempt =
      recent ??
      (await tx.trainingAttempt.create({
        data: {
          assignmentId: assignment.id,
          courseVersion: course.version,
          answers: { lessonKey: lesson.key },
        },
      }));
    return {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      lessonKey: lesson.key,
      lessonTitle: lesson.title,
      questions: await quizPayload(tx, course.id, positions),
    };
  });
}

export async function submitTrainingAttempt(
  userId: number,
  attemptId: number,
  answers: SubmittedAnswer[],
) {
  if (!Array.isArray(answers)) throw new Error("INVALID_ANSWERS");
  return prisma.$transaction(
    async (tx) => {
      const attempt = await tx.trainingAttempt.findUnique({
        where: { id: attemptId },
        include: {
          assignment: {
            include: {
              course: { include: { questions: { orderBy: { position: "asc" } } } },
            },
          },
        },
      });
      if (!attempt || attempt.assignment.userId !== userId)
        throw new Error("ATTEMPT_NOT_FOUND");
      if (attempt.status !== TrainingAttemptStatus.IN_PROGRESS)
        throw new Error("ATTEMPT_COMPLETED");
      const lessonKey = attemptLessonKey(attempt.answers);
      const lessons = courseLessons(attempt.assignment.course);
      const lesson = lessons.find((item) => item.key === lessonKey);
      if (!lessonKey || !lesson) throw new Error("INVALID_LESSON");
      const unique = new Map<number, number>();
      for (const answer of answers) {
        if (
          !Number.isInteger(answer?.questionId) ||
          !Number.isInteger(answer?.optionIndex) ||
          answer.optionIndex < 0 ||
          answer.optionIndex > 3 ||
          unique.has(answer.questionId)
        )
          throw new Error("INVALID_ANSWERS");
        unique.set(answer.questionId, answer.optionIndex);
      }
      const positions = new Set(lessonQuestionPositions(lessonKey));
      const questions = attempt.assignment.course.questions.filter((question) =>
        positions.has(question.position),
      );
      if (!questions.length || unique.size !== questions.length)
        throw new Error("INVALID_ANSWERS");
      if (questions.some((question) => !unique.has(question.id)))
        throw new Error("INVALID_ANSWERS");

      const score = questions.reduce(
        (total, question) =>
          total + (unique.get(question.id) === question.correctOption ? 1 : 0),
        0,
      );
      const percent = (score / questions.length) * 100;
      const passed = percent >= attempt.assignment.course.passScorePercent;
      const completedAt = new Date();
      await tx.trainingAttempt.update({
        where: { id: attempt.id },
        data: {
          answers: { lessonKey, answers } as unknown as Prisma.InputJsonValue,
          score,
          percent,
          status: passed
            ? TrainingAttemptStatus.PASSED
            : TrainingAttemptStatus.FAILED,
          completedAt,
        },
      });
      const attemptsCount = await tx.trainingAttempt.count({
        where: { assignmentId: attempt.assignmentId, completedAt: { not: null } },
      });
      const completedAttempts = await tx.trainingAttempt.findMany({
        where: { assignmentId: attempt.assignmentId, completedAt: { not: null } },
        select: { status: true, answers: true },
      });
      const passedKeys = passedLessonKeys(completedAttempts, lessons);
      const allLessonQuizzesPassed = lessons.every(
        (item) => !lessonQuestionPositions(item.key).length || passedKeys.has(item.key),
      );
      const progress = lessonStates(attempt.assignment.course, attempt.assignment);
      const allLessonsWatched = hasRequiredLessonCoverage(
        progress.lessons,
        progress.stored,
        attempt.assignment.course.requiredCoverage,
      );
      const alreadyPassed =
        attempt.assignment.status === TrainingStatus.PASSED;
      await tx.trainingAssignment.update({
        where: { id: attempt.assignmentId },
        data: {
          attemptsCount,
          bestScore: Math.max(attempt.assignment.bestScore, score),
          bestPercent: Math.max(attempt.assignment.bestPercent, percent),
          status:
            alreadyPassed
              ? TrainingStatus.PASSED
              : allLessonQuizzesPassed && allLessonsWatched
                ? TrainingStatus.READY_FOR_TEST
                : TrainingStatus.IN_PROGRESS,
          lastViewedAt: completedAt,
        },
      });
      await tx.trainingAudit.create({
        data: {
          assignmentId: attempt.assignmentId,
          actorId: userId,
          action: TrainingAuditAction.QUIZ_SUBMITTED,
        metadata: { attemptId: attempt.id, lessonKey, score, percent, passed },
        },
      });
      return {
        attemptId: attempt.id,
        score,
        total: questions.length,
        percent: Math.round(percent),
        passed,
        lessonKey,
        lessonTitle: lesson.title,
        allLessonQuizzesPassed,
        review: questions.map((question) => ({
          position: question.position,
          correct: unique.get(question.id) === question.correctOption,
          correctOption: question.correctOption,
          explanation: question.explanation,
        })),
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function trainingReport() {
  return prisma.trainingAssignment.findMany({
    where: { course: { active: true, mandatory: true } },
    select: {
      id: true,
      status: true,
      progressPercent: true,
      bestScore: true,
      bestPercent: true,
      attemptsCount: true,
      lastViewedAt: true,
      passedAt: true,
      overrideReason: true,
      overrideExpiresAt: true,
      user: { select: { id: true, name: true, role: true, active: true } },
      course: { select: { title: true, version: true } },
    },
    orderBy: [{ user: { name: "asc" } }, { course: { version: "desc" } }],
  });
}

export async function grantTrainingOverride(
  directorId: number,
  assignmentId: number,
  reason: string,
  hours = 24,
) {
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 10 || normalizedReason.length > 500)
    throw new Error("INVALID_OVERRIDE");
  const durationHours = Math.max(1, Math.min(72, Math.round(hours)));
  const expiresAt = new Date(Date.now() + durationHours * 60 * 60 * 1000);
  return prisma.$transaction(async (tx) => {
    const assignment = await tx.trainingAssignment.findUnique({
      where: { id: assignmentId },
      select: { id: true },
    });
    if (!assignment) throw new Error("TRAINING_NOT_FOUND");
    const updated = await tx.trainingAssignment.update({
      where: { id: assignmentId },
      data: {
        overrideById: directorId,
        overrideReason: normalizedReason,
        overrideExpiresAt: expiresAt,
      },
    });
    await tx.trainingAudit.create({
      data: {
        assignmentId,
        actorId: directorId,
        action: TrainingAuditAction.OVERRIDE_GRANTED,
        reason: normalizedReason,
        metadata: { expiresAt, durationHours },
      },
    });
    return updated;
  });
}
