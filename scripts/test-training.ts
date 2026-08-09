import "./require-test-database";

import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import {
  Role,
  TrainingAttemptStatus,
  TrainingAuditAction,
  TrainingStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { MEASURER_QUESTIONS } from "@/lib/training-course";
import {
  acknowledgeTraining,
  ensureCurrentMeasurerTraining,
  grantTrainingOverride,
  hasTrainingClearance,
  recordTrainingHeartbeat,
  startTrainingAttempt,
  submitTrainingAttempt,
  trainingReport,
} from "@/lib/services/training.service";

const tag = `training-${Date.now()}`;
const email = (name: string) => `${tag}-${name}@test.local`;

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
      videoDuration: 100,
      acknowledgedAt: new Date(),
      status: TrainingStatus.READY_FOR_TEST,
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
      questions: { create: MEASURER_QUESTIONS },
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

  await recordTrainingHeartbeat(measurer.id, { currentTime: 99, duration: 100, playerState: "PLAYING", courseVersion: 999 });
  assert.equal((await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id } })).progressPercent, 0, "seek-to-end unlocked progress");
  await assert.rejects(() => startTrainingAttempt(measurer.id), /QUIZ_LOCKED/);

  for (let start = 0; start < 91; start += 7) {
    await prisma.trainingAssignment.update({
      where: { id: assignment.id },
      data: { lastVideoTime: start, lastHeartbeatAt: new Date(Date.now() - 7_000) },
    });
    await recordTrainingHeartbeat(measurer.id, { currentTime: Math.min(start + 7, 91), duration: 100, playerState: "PLAYING", courseVersion: 999 });
  }
  const watched = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: assignment.id } });
  assert(watched.progressPercent >= 90);
  await assert.rejects(() => startTrainingAttempt(measurer.id), /QUIZ_LOCKED/, "acknowledgement was not required");
  await acknowledgeTraining(measurer.id);
  const started = await startTrainingAttempt(measurer.id);
  assert.equal(started.questions.length, 15);
  assert(!JSON.stringify(started.questions).includes("correctOption"), "correct answers leaked before submit");
  const storedQuestions = await prisma.trainingQuestion.findMany({ where: { courseId: course.id }, orderBy: { position: "asc" } });
  const twelveAnswers = storedQuestions.map((question, index) => ({ questionId: question.id, optionIndex: index < 12 ? question.correctOption : (question.correctOption + 1) % 4 }));
  const passed = await submitTrainingAttempt(measurer.id, started.attemptId, twelveAnswers);
  assert.equal(passed.score, 12);
  assert.equal(passed.passed, true);
  assert.equal(await prisma.$transaction((tx) => hasTrainingClearance(tx, measurer.id)), true);

  const failedAssignment = await ready(secondMeasurer.id);
  const failedAttempt = await startTrainingAttempt(secondMeasurer.id);
  await assert.rejects(() => submitTrainingAttempt(measurer.id, failedAttempt.attemptId, twelveAnswers), /ATTEMPT_NOT_FOUND/, "attempt IDOR succeeded");
  const elevenAnswers = storedQuestions.map((question, index) => ({ questionId: question.id, optionIndex: index < 11 ? question.correctOption : (question.correctOption + 1) % 4 }));
  const failed = await submitTrainingAttempt(secondMeasurer.id, failedAttempt.attemptId, elevenAnswers);
  assert.equal(failed.score, 11);
  assert.equal(failed.passed, false);
  const retry = await startTrainingAttempt(secondMeasurer.id);
  const perfect = await submitTrainingAttempt(secondMeasurer.id, retry.attemptId, storedQuestions.map((question) => ({ questionId: question.id, optionIndex: question.correctOption })));
  assert.equal(perfect.score, 15);
  const retryState = await prisma.trainingAssignment.findUniqueOrThrow({ where: { id: failedAssignment.id } });
  assert.equal(retryState.attemptsCount, 2);
  assert.equal(retryState.bestScore, 15);

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
