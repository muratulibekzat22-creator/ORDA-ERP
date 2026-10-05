import "./require-test-database";

import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import {
  Prisma,
  Role,
  TrainingAttemptStatus,
  TrainingAuditAction,
  TrainingStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { MEASURER_LESSONS, MEASURER_QUESTIONS } from "@/lib/training-course";
import {
  acknowledgeTraining,
  ensureCurrentMeasurerTraining,
  grantTrainingOverride,
  hasTrainingClearance,
  measurerNeedsMandatoryTraining,
  recordTrainingHeartbeat,
  startTrainingAttempt,
  submitTrainingAttempt,
  trainingReport,
} from "@/lib/services/training.service";

const tag = `training-${Date.now()}`;
const email = (name: string) => `${tag}-${name}@test.local`;
const lesson = MEASURER_LESSONS[0];
const lessonQuestions = MEASURER_QUESTIONS.filter((question) => question.lessonKey === lesson.key);

async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: tag } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);
  const assignments = await prisma.trainingAssignment.findMany({
    where: { OR: [{ userId: { in: userIds } }, { course: { slug: tag } }] },
    select: { id: true },
  });
  const assignmentIds = assignments.map((item) => item.id);
  await prisma.trainingAudit.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
  await prisma.trainingAttempt.deleteMany({ where: { assignmentId: { in: assignmentIds } } });
  await prisma.trainingAssignment.deleteMany({ where: { id: { in: assignmentIds } } });
  await prisma.trainingQuestion.deleteMany({ where: { course: { slug: tag } } });
  await prisma.trainingCourse.deleteMany({ where: { slug: tag } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
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
  const [director, manager, measurer, secondMeasurer, overrideMeasurer] =
    await Promise.all([
      prisma.user.create({ data: { name: tag, email: email("director"), password, role: Role.DIRECTOR } }),
      prisma.user.create({ data: { name: tag, email: email("manager"), password, role: Role.MANAGER } }),
      prisma.user.create({ data: { name: tag, email: email("measurer"), password, role: Role.MEASURER } }),
      prisma.user.create({ data: { name: tag, email: email("measurer-2"), password, role: Role.MEASURER } }),
      prisma.user.create({ data: { name: tag, email: email("override"), password, role: Role.MEASURER } }),
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
  assert.equal(await measurerNeedsMandatoryTraining(measurer.id), true);

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
  assert.equal(await measurerNeedsMandatoryTraining(measurer.id), false);

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
    await prisma.$disconnect();
  });
