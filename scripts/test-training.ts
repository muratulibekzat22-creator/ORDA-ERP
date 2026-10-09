import "./require-test-database";

import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import {
  Prisma,
  PrismaClient,
  Role,
  TrainingAttemptStatus,
  TrainingAuditAction,
  TrainingStatus,
} from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import { prisma } from "@/lib/prisma";
import { MEASURER_LESSONS, MEASURER_QUESTIONS } from "@/lib/training-course";
import {
  acknowledgeTraining,
  ensureCurrentMeasurerTraining,
  getMyTraining,
  grantTrainingOverride,
  hasTrainingClearance,
  recordTrainingHeartbeat,
  startTrainingAttempt,
  submitTrainingAttempt,
  trainingReport,
} from "@/lib/services/training.service";

const tag = `training-${Date.now()}`;
const email = (name: string) => `${tag}-${name}@test.local`;
const lesson = MEASURER_LESSONS[0];
const lessonQuestions = MEASURER_QUESTIONS.filter((question) => question.lessonKey === lesson.key);
const navigationLessons = MEASURER_LESSONS.slice(0, 2);
const navigationLessonKeys = new Set(navigationLessons.map((item) => item.key));
const navigationQuestions = MEASURER_QUESTIONS.filter((question) => navigationLessonKeys.has(question.lessonKey));
const cleanupDatabaseUrl = process.env.TEST_CLEANUP_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
const cleanupPrisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: cleanupDatabaseUrl, max: 1 }),
  log: ["error"],
});

async function cleanup() {
  const users = await cleanupPrisma.user.findMany({
    where: { email: { startsWith: tag } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const assignments = await cleanupPrisma.trainingAssignment.findMany({
    where: { OR: [{ userId: { in: userIds } }, { course: { slug: tag } }] },
    select: { id: true },
  });
  const assignmentIds = assignments.map((item) => item.id);
  await cleanupPrisma.trainingAudit.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
  await cleanupPrisma.trainingAttempt.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
  await cleanupPrisma.trainingAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
  await cleanupPrisma.trainingQuestion.deleteMany({ where: { course: { slug: tag } } });
  await cleanupPrisma.trainingCourse.deleteMany({ where: { slug: tag } });
  await cleanupPrisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function ready(userId: number) {
  const assignment = await prisma.$transaction((tx) =>
    ensureCurrentMeasurerTraining(tx, userId),
  );
  assert(assignment);
  return prisma.trainingAssignment.update({
    where: { id: assignment.id },
    data: {
      progressPercent: 90,
      watchedRanges: [[0, 90]],
      lessonProgress: {
        [lesson.key]: {
          watchedRanges: [[0, 90]],
          videoDuration: 100,
          lastVideoTime: 90,
          lastHeartbeatAt: new Date().toISOString(),
          progressPercent: 90,
        },
      },
      videoDuration: 100,
      status: TrainingStatus.IN_PROGRESS,
    },
  });
}

async function main() {
  await cleanup();
  const password = await bcrypt.hash("Training-only-password-1!", 12);
  const [director, manager, measurer, secondMeasurer, overrideMeasurer, navigationMeasurer] =
    await Promise.all([
      prisma.user.create({ data: { name: tag, email: email("director"), password, role: Role.DIRECTOR } }),
      prisma.user.create({ data: { name: tag, email: email("manager"), password, role: Role.MANAGER } }),
      prisma.user.create({ data: { name: tag, email: email("measurer"), password, role: Role.MEASURER } }),
      prisma.user.create({ data: { name: tag, email: email("measurer-2"), password, role: Role.MEASURER } }),
      prisma.user.create({ data: { name: tag, email: email("override"), password, role: Role.MEASURER } }),
      prisma.user.create({ data: { name: tag, email: email("navigation"), password, role: Role.MEASURER } }),
    ]);
  const course = await prisma.trainingCourse.create({
    data: {
      slug: tag,
      version: 999,
      title: "Training integration",
      description: "Isolated integration course",
      targetRole: Role.MEASURER,
      videoLanguage: "kk",
      quizLanguage: "ru",
      youtubeVideoId: "jBk1-0ku2PY",
      passScorePercent: 80,
      requiredCoverage: 90,
      videoLessons: [lesson] as unknown as Prisma.InputJsonValue,
      questions: {
        create: lessonQuestions.map((question) => ({
          position: question.position,
          question: question.question,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
        })),
      },
    },
  });
  assert(course.id > 0);

  const managerAssignment = await prisma.$transaction((tx) =>
    ensureCurrentMeasurerTraining(tx, manager.id),
  );
  assert.equal(managerAssignment, null, "MANAGER received a measurer course");
  const assignment = await prisma.$transaction((tx) =>
    ensureCurrentMeasurerTraining(tx, measurer.id),
  );
  assert(assignment, "new MEASURER did not receive an assignment");
  assert.equal(await prisma.trainingAssignment.count({ where: { userId: manager.id } }), 0);
  assert.equal(await prisma.$transaction((tx) => hasTrainingClearance(tx, measurer.id)), false);

  await recordTrainingHeartbeat(measurer.id, { lessonKey: lesson.key, currentTime: 99, duration: 100, playerState: "PLAYING", courseVersion: 999 });
  assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).progressPercent, 0, "seek-to-end unlocked progress");
  await assert.rejects(() => startTrainingAttempt(measurer.id, lesson.key), /QUIZ_LOCKED/);

  for (let start = 0; start < 91; start += 7) {
    const current = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
    const lessonProgress = current.lessonProgress as Record<string, Record<string, unknown>>;
    await prisma.trainingAssignment.update({
      where: { id: assignment.id },
      data: {
        lessonProgress: {
          ...lessonProgress,
          [lesson.key]: {
            ...lessonProgress[lesson.key],
            lastVideoTime: start,
            lastHeartbeatAt: new Date(Date.now() - 7_000).toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
    await recordTrainingHeartbeat(measurer.id, { lessonKey: lesson.key, currentTime: Math.min(start + 7, 91), duration: 100, playerState: "PLAYING", courseVersion: 999 });
  }
  const watched = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  assert(watched.progressPercent >= 90);
  const started = await startTrainingAttempt(measurer.id, lesson.key);
  assert.equal(started.questions.length, lessonQuestions.length);
  assert(!JSON.stringify(started.questions).includes("correctOption"), "correct answers leaked before submit");
  const storedQuestions = await prisma.trainingQuestion.findMany({ where: { courseId: course.id }, orderBy: { position: "asc" } });
  const passingCount = Math.ceil(storedQuestions.length * 0.8);
  const passingAnswers = storedQuestions.map((question, index) => ({ questionId: question.id, optionIndex: index < passingCount ? question.correctOption : (question.correctOption + 1) % 4 }));
  const passed = await submitTrainingAttempt(measurer.id, started.attemptId, passingAnswers);
  assert.equal(passed.score, passingCount);
  assert.equal(passed.passed, true);
  assert.equal(passed.allLessonQuizzesPassed, true);
  assert.equal(await prisma.$transaction((tx) => hasTrainingClearance(tx, measurer.id)), false);
  await acknowledgeTraining(measurer.id);
  assert.equal(await prisma.$transaction((tx) => hasTrainingClearance(tx, measurer.id)), true);

  const failedAssignment = await ready(secondMeasurer.id);
  const failedAttempt = await startTrainingAttempt(secondMeasurer.id, lesson.key);
  await assert.rejects(() => submitTrainingAttempt(measurer.id, failedAttempt.attemptId, passingAnswers), /ATTEMPT_NOT_FOUND/, "attempt IDOR succeeded");
  const failingCount = passingCount - 1;
  const failingAnswers = storedQuestions.map((question, index) => ({ questionId: question.id, optionIndex: index < failingCount ? question.correctOption : (question.correctOption + 1) % 4 }));
  const failed = await submitTrainingAttempt(secondMeasurer.id, failedAttempt.attemptId, failingAnswers);
  assert.equal(failed.score, failingCount);
  assert.equal(failed.passed, false);
  const retry = await startTrainingAttempt(secondMeasurer.id, lesson.key);
  const perfect = await submitTrainingAttempt(secondMeasurer.id, retry.attemptId, storedQuestions.map((question) => ({ questionId: question.id, optionIndex: question.correctOption })));
  assert.equal(perfect.score, storedQuestions.length);
  const retryState = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: failedAssignment.id } });
  assert.equal(retryState.attemptsCount, 2);
  assert.equal(retryState.bestScore, storedQuestions.length);

  const navigationCourse = await prisma.trainingCourse.create({
    data: {
      slug: tag,
      version: 1000,
      title: "Training navigation integration",
      description: "Isolated multi-lesson navigation course",
      targetRole: Role.MEASURER,
      videoLanguage: "kk",
      quizLanguage: "ru",
      youtubeVideoId: navigationLessons[0].youtubeVideoId,
      passScorePercent: 80,
      requiredCoverage: 90,
      videoLessons: navigationLessons as unknown as Prisma.InputJsonValue,
      questions: {
        create: navigationQuestions.map((question) => ({
          position: question.position,
          question: question.question,
          options: question.options,
          correctOption: question.correctOption,
          explanation: question.explanation,
        })),
      },
    },
  });
  const navigationAssignment = await prisma.$transaction((tx) =>
    ensureCurrentMeasurerTraining(tx, navigationMeasurer.id),
  );
  assert(navigationAssignment);
  await prisma.trainingAssignment.update({
    where: { id: navigationAssignment.id },
    data: {
      progressPercent: 50,
      status: TrainingStatus.IN_PROGRESS,
      lessonProgress: {
        [navigationLessons[0].key]: {
          watchedRanges: [[0, 90]],
          videoDuration: 100,
          lastVideoTime: 90,
          lastHeartbeatAt: new Date().toISOString(),
          progressPercent: 90,
        },
      },
    },
  });
  const navigationAttempt = await startTrainingAttempt(
    navigationMeasurer.id,
    navigationLessons[0].key,
  );
  const restored = await getMyTraining(navigationMeasurer.id);
  const restoredFirst = restored.course.lessons.find((item) => item.key === navigationLessons[0].key);
  const restoredSecond = restored.course.lessons.find((item) => item.key === navigationLessons[1].key);
  assert(restoredFirst);
  assert(restoredSecond);
  assert.equal(restoredFirst.videoCompleted, true, "watched video was lost after opening another lesson");
  assert.equal(restoredFirst.quizInProgress, true, "active quiz was not restored from the database");
  assert.equal(restoredFirst.quizStatus, "IN_PROGRESS");
  assert.equal(restoredFirst.lessonCompleted, false, "opening another lesson completed the previous lesson");
  assert.equal(restoredFirst.canStartQuiz, true, "previous lesson quiz became unavailable");
  assert.equal(restoredSecond.progressPercent, 0, "missing progress must open as a clean lesson state");
  assert.equal(restoredSecond.videoCompleted, false);
  assert.equal(restoredSecond.lessonCompleted, false);
  assert.equal(restoredSecond.youtubeVideoId, navigationLessons[1].youtubeVideoId);
  assert.notEqual(restored.status, TrainingStatus.PASSED);
  await recordTrainingHeartbeat(navigationMeasurer.id, { lessonKey: navigationLessons[1].key, currentTime: 0, duration: 100, playerState: "CUED", courseVersion: navigationCourse.version });
  const progressAfterFirstOpen = (await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: navigationAssignment.id } })).lessonProgress as Record<string, { progressPercent: number }>;
  assert.equal(progressAfterFirstOpen[navigationLessons[0].key]?.progressPercent, 90, "opening lesson 2 overwrote lesson 1 progress");
  assert.equal(progressAfterFirstOpen[navigationLessons[1].key]?.progressPercent, 0, "first open did not initialize lesson 2 safely");
  const resumed = await startTrainingAttempt(navigationMeasurer.id, navigationLessons[0].key);
  assert.equal(resumed.attemptId, navigationAttempt.attemptId, "returning to a lesson created a duplicate quiz attempt");

  const navigationStoredQuestions = await prisma.trainingQuestion.findMany({
    where: {
      courseId: navigationCourse.id,
      position: { in: lessonQuestions.map((question) => question.position) },
    },
    orderBy: { position: "asc" },
  });
  const wrongAnswers = navigationStoredQuestions.map((question) => ({
    questionId: question.id,
    optionIndex: (question.correctOption + 1) % 4,
  }));
  const navigationFailed = await submitTrainingAttempt(
    navigationMeasurer.id,
    navigationAttempt.attemptId,
    wrongAnswers,
  );
  assert.equal(navigationFailed.passed, false);
  const afterFailure = await getMyTraining(navigationMeasurer.id);
  const failedLesson = afterFailure.course.lessons.find((item) => item.key === navigationLessons[0].key);
  assert.equal(failedLesson?.quizStatus, "FAILED");
  assert.equal(failedLesson?.canStartQuiz, true, "failed lesson cannot be retried after navigation");
  const navigationRetry = await startTrainingAttempt(navigationMeasurer.id, navigationLessons[0].key);
  assert.notEqual(navigationRetry.attemptId, navigationAttempt.attemptId);
  await submitTrainingAttempt(
    navigationMeasurer.id,
    navigationRetry.attemptId,
    navigationStoredQuestions.map((question) => ({
      questionId: question.id,
      optionIndex: question.correctOption,
    })),
  );
  const afterPass = await getMyTraining(navigationMeasurer.id);
  const passedFirstLesson = afterPass.course.lessons.find((item) => item.key === navigationLessons[0].key);
  const unfinishedSecondLesson = afterPass.course.lessons.find((item) => item.key === navigationLessons[1].key);
  assert.equal(passedFirstLesson?.lessonCompleted, true);
  assert.equal(passedFirstLesson?.quizStatus, "PASSED");
  assert.equal(unfinishedSecondLesson?.lessonCompleted, false);
  assert.notEqual(afterPass.status, TrainingStatus.PASSED, "one passed lesson completed the entire course");

  const overrideAssignment = await prisma.$transaction((tx) => ensureCurrentMeasurerTraining(tx, overrideMeasurer.id));
  assert(overrideAssignment);
  assert.equal(await prisma.$transaction((tx) => hasTrainingClearance(tx, overrideMeasurer.id)), false);
  await grantTrainingOverride(director.id, overrideAssignment.id, "Срочный выезд под контролем директора", 2);
  assert.equal(await prisma.$transaction((tx) => hasTrainingClearance(tx, overrideMeasurer.id)), true);
  assert.equal(await prisma.trainingAudit.count({ where: { assignmentId: overrideAssignment.id, action: TrainingAuditAction.OVERRIDE_GRANTED } }), 1);

  const report = await trainingReport();
  assert(report.some((row) => row.user.id === measurer.id && row.status === TrainingStatus.PASSED));
  assert.equal(await prisma.trainingAttempt.count({ where: { assignmentId: failedAssignment.id, status: TrainingAttemptStatus.PASSED } }), 1);
}

main()
  .then(() => console.log("training integration and RBAC checks passed"))
  .finally(async () => {
    await cleanup();
    await Promise.all([prisma.$disconnect(), cleanupPrisma.$disconnect()]);
  });
