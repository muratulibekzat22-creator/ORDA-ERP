import {
  Prisma,
  Role,
  TrainingAttemptStatus,
  TrainingAuditAction,
  TrainingStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import {
  acceptedHeartbeatRange,
  mergeWatchedRanges,
  parseWatchedRanges,
  watchedPercent,
} from "@/lib/training-progress";

type Db = Prisma.TransactionClient;
type Heartbeat = {
  currentTime: number;
  duration: number;
  playerState: string;
  courseVersion: number;
};
type SubmittedAnswer = { questionId: number; optionIndex: number };

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
      course: { include: { _count: { select: { questions: true } } } },
      attempts: {
        where: { completedAt: { not: null } },
        select: {
          id: true,
          score: true,
          percent: true,
          status: true,
          startedAt: true,
          completedAt: true,
        },
        orderBy: { startedAt: "desc" },
      },
    },
  });
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
      passScorePercent: assignment.course.passScorePercent,
      requiredCoverage: assignment.course.requiredCoverage,
      questionsCount: assignment.course._count.questions,
    },
    attempts: assignment.attempts,
    canAcknowledge:
      assignment.progressPercent >= assignment.course.requiredCoverage &&
      !assignment.acknowledgedAt,
    canStartQuiz:
      assignment.progressPercent >= assignment.course.requiredCoverage &&
      Boolean(assignment.acknowledgedAt),
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
    !Number.isInteger(input.courseVersion)
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

    const receivedAt = new Date();
    const stableDuration = assignment.videoDuration ?? input.duration;
    const durationChanged =
      assignment.videoDuration !== null &&
      Math.abs(input.duration - assignment.videoDuration) >
        Math.max(3, assignment.videoDuration * 0.02);
    const accepted = durationChanged
      ? null
      : acceptedHeartbeatRange({
          previousTime: assignment.lastVideoTime,
          previousAt: assignment.lastHeartbeatAt,
          currentTime: input.currentTime,
          receivedAt,
          playerState: input.playerState,
        });
    const ranges = parseWatchedRanges(assignment.watchedRanges);
    const merged = mergeWatchedRanges(
      accepted ? [...ranges, accepted] : ranges,
      stableDuration,
    );
    const progressPercent = Math.max(
      assignment.progressPercent,
      watchedPercent(merged, stableDuration),
    );
    const status =
      assignment.status === TrainingStatus.PASSED ||
      assignment.status === TrainingStatus.FAILED
        ? assignment.status
        : assignment.acknowledgedAt &&
            progressPercent >= course.requiredCoverage
          ? TrainingStatus.READY_FOR_TEST
          : progressPercent > 0
            ? TrainingStatus.IN_PROGRESS
            : TrainingStatus.NOT_STARTED;
    const updated = await tx.trainingAssignment.update({
      where: { id: assignment.id },
      data: {
        watchedRanges: merged as Prisma.InputJsonValue,
        progressPercent,
        videoDuration: stableDuration,
        lastVideoTime: input.currentTime,
        lastHeartbeatAt: receivedAt,
        lastViewedAt: receivedAt,
        status,
      },
    });
    return {
      progressPercent: Math.round(updated.progressPercent * 10) / 10,
      canAcknowledge:
        updated.progressPercent >= course.requiredCoverage &&
        !updated.acknowledgedAt,
      canStartQuiz:
        updated.progressPercent >= course.requiredCoverage &&
        Boolean(updated.acknowledgedAt),
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
    if (assignment.progressPercent < course.requiredCoverage)
      throw new Error("ACKNOWLEDGEMENT_LOCKED");
    if (assignment.acknowledgedAt) return assignment;
    const now = new Date();
    const updated = await tx.trainingAssignment.update({
      where: { id: assignment.id },
      data: {
        acknowledgedAt: now,
        status:
          assignment.status === TrainingStatus.PASSED
            ? TrainingStatus.PASSED
            : TrainingStatus.READY_FOR_TEST,
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

const quizPayload = async (db: Db, courseId: number) =>
  db.trainingQuestion.findMany({
    where: { courseId },
    select: { id: true, position: true, question: true, options: true },
    orderBy: { position: "asc" },
  });

export async function startTrainingAttempt(userId: number) {
  return prisma.$transaction(async (tx) => {
    const assignment = await ensureCurrentMeasurerTraining(tx, userId);
    if (!assignment) throw new Error("TRAINING_NOT_FOUND");
    const course = await tx.trainingCourse.findUniqueOrThrow({
      where: { id: assignment.courseId },
    });
    if (
      assignment.progressPercent < course.requiredCoverage ||
      !assignment.acknowledgedAt
    )
      throw new Error("QUIZ_LOCKED");
    const recent = await tx.trainingAttempt.findFirst({
      where: {
        assignmentId: assignment.id,
        status: TrainingAttemptStatus.IN_PROGRESS,
        startedAt: { gt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      },
      orderBy: { startedAt: "desc" },
    });
    const attempt =
      recent ??
      (await tx.trainingAttempt.create({
        data: { assignmentId: assignment.id, courseVersion: course.version },
      }));
    return {
      attemptId: attempt.id,
      startedAt: attempt.startedAt,
      questions: await quizPayload(tx, course.id),
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
      const questions = attempt.assignment.course.questions;
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
          answers: answers as unknown as Prisma.InputJsonValue,
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
      const alreadyPassed =
        attempt.assignment.status === TrainingStatus.PASSED;
      await tx.trainingAssignment.update({
        where: { id: attempt.assignmentId },
        data: {
          attemptsCount,
          bestScore: Math.max(attempt.assignment.bestScore, score),
          bestPercent: Math.max(attempt.assignment.bestPercent, percent),
          status:
            passed || alreadyPassed
              ? TrainingStatus.PASSED
              : TrainingStatus.FAILED,
          passedAt:
            attempt.assignment.passedAt ?? (passed ? completedAt : null),
          lastViewedAt: completedAt,
        },
      });
      await tx.trainingAudit.create({
        data: {
          assignmentId: attempt.assignmentId,
          actorId: userId,
          action: TrainingAuditAction.QUIZ_SUBMITTED,
          metadata: { attemptId: attempt.id, score, percent, passed },
        },
      });
      return {
        attemptId: attempt.id,
        score,
        total: questions.length,
        percent: Math.round(percent),
        passed,
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
