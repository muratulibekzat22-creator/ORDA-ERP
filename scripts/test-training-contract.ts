import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MEASURER_COURSE,
  MEASURER_LESSONS,
  MEASURER_QUESTIONS,
} from "@/lib/training-course";
import {
  acceptedHeartbeatRange,
  mergeWatchedRanges,
  watchedPercent,
} from "@/lib/training-progress";

const merged = mergeWatchedRanges(
  [[0, 7], [6.8, 14], [30, 36], [30, 36]],
  100,
);
assert.deepEqual(merged, [[0, 14], [30, 36]]);
assert.equal(Math.round(watchedPercent(merged, 100)), 20);
assert.deepEqual(
  acceptedHeartbeatRange({ previousTime: 10, previousAt: new Date(0), currentTime: 17, receivedAt: new Date(7_000), playerState: "PLAYING" }),
  [10, 17],
);
assert.equal(
  acceptedHeartbeatRange({ previousTime: 10, previousAt: new Date(0), currentTime: 95, receivedAt: new Date(7_000), playerState: "PLAYING" }),
  null,
  "seeking to the end must not create watched coverage",
);
assert.equal(
  acceptedHeartbeatRange({ previousTime: 10, previousAt: new Date(0), currentTime: 17, receivedAt: new Date(7_000), playerState: "PAUSED" }),
  null,
);

assert.equal(MEASURER_COURSE.version, 4);
assert.equal(MEASURER_COURSE.youtubeVideoId, "jBk1-0ku2PY");
assert.equal(MEASURER_COURSE.requiredCoverage, 90);
assert.equal(MEASURER_COURSE.passScorePercent, 85);
assert.equal(MEASURER_LESSONS.length, 10);
assert.equal(new Set(MEASURER_LESSONS.map((lesson) => lesson.key)).size, 10);
assert.equal(new Set(MEASURER_LESSONS.map((lesson) => lesson.youtubeVideoId)).size, 10);
assert(MEASURER_LESSONS.some((lesson) => lesson.youtubeVideoId === "Vy9FQd3a1Og"));
assert.equal(MEASURER_QUESTIONS.length, 32);
const lessonKeys = new Set(MEASURER_LESSONS.map((lesson) => lesson.key));
for (const question of MEASURER_QUESTIONS) {
  assert.equal(question.options.length, 4);
  assert(question.correctOption >= 0 && question.correctOption < 4);
  assert(lessonKeys.has(question.lessonKey), `unknown lesson for question ${question.position}`);
}
for (const lesson of MEASURER_LESSONS)
  assert(MEASURER_QUESTIONS.filter((question) => question.lessonKey === lesson.key).length >= 3, `${lesson.key} has no useful quiz`);

const service = readFileSync("lib/services/training.service.ts", "utf8");
const trainingApi = readFileSync("lib/training-api.ts", "utf8");
const measurement = readFileSync("lib/services/measurement.service.ts", "utf8");
const workspace = readFileSync("components/training/TrainingWorkspace.tsx", "utf8");
const shell = readFileSync("components/layout/RouteShell.tsx", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const employeeUpdate = readFileSync("app/api/employees/[id]/route.ts", "utf8");
const employeeService = readFileSync("lib/services/employee.service.ts", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");
const chatGptAccessApi = readFileSync("app/api/training/chatgpt-access/route.ts", "utf8");
const chatGptAccessCard = readFileSync("components/training/ChatGptOfficeAccessCard.tsx", "utf8");
const designPrompt = readFileSync("lib/orders/design-brief.ts", "utf8");
const login = readFileSync("app/login/page.tsx", "utf8");
const home = readFileSync("app/page.tsx", "utf8");
const directorReport = readFileSync("components/training/DirectorTrainingReport.tsx", "utf8");

assert(service.includes("select: { id: true, position: true, question: true, options: true }"), "quiz read projection can expose answers");
assert(!readFileSync("app/api/training/attempts/route.ts", "utf8").includes("correctOption"), "quiz route exposes answers");
assert(service.includes("attempt.assignment.userId !== userId"), "attempt IDOR guard missing");
assert(service.includes("unique.get(question.id) === question.correctOption"), "server-side scoring missing");
assert(trainingApi.includes("Role.MEASURER") || trainingApi.includes("roles.includes"));
assert(measurement.includes("hasTrainingClearance") && measurement.includes("TRAINING_REQUIRED"));
assert(workspace.includes("https://www.youtube.com/iframe_api") && workspace.includes("7_000"));
assert(workspace.includes("course.lessons.map") && workspace.includes("lessonKey"));
assert(workspace.includes("Тест по выбранному видео") && workspace.includes("Пройти тест по видео"));
assert(service.includes("lessonQuestionPositions") && service.includes("passedLessonKeys"), "per-video quiz enforcement missing");
assert(service.includes("hasRequiredLessonCoverage"), "each lesson must reach required coverage");
assert(
  nextConfig.includes("script-src 'self' 'unsafe-inline' https://www.youtube.com") &&
    nextConfig.includes("frame-src https://www.youtube.com https://www.youtube-nocookie.com"),
  "Content Security Policy blocks the embedded YouTube player",
);
assert(workspace.includes("overflow-x-hidden") && workspace.includes("aspect-video"));
assert(shell.includes('"/training"') && shell.includes('role === "MEASURER"'));
assert(proxy.includes('firstSegment === "training"'));
assert(employeeService.includes("ensureCurrentMeasurerTraining") && employeeUpdate.includes("ensureCurrentMeasurerTraining"));
assert(login.includes('session?.user.role === "MEASURER"') && login.includes('router.replace(trainingResponse.ok && training.status === "PASSED" ? callbackUrl : "/training")'), "incomplete measurer training is not opened after login");
assert(home.includes("measurerNeedsMandatoryTraining") && home.includes('redirect("/training")'), "measurer dashboard does not preserve the mandatory training entry point");
assert(directorReport.includes("row.passedLessonsCount") && directorReport.includes("row.lessonsCount") && !directorReport.includes("row.bestScore}/15"), "director training report does not show per-video quiz progress");
assert(chatGptAccessApi.includes("Role.MEASURER") && chatGptAccessApi.includes('"Cache-Control": "private, no-store, max-age=0"'));
assert(chatGptAccessApi.includes("ownerNotified") && service.includes("CHATGPT_ACCESS_REVEALED"));
assert(chatGptAccessCard.includes("Получить рабочий логин и пароль") && chatGptAccessCard.includes("Не фотографируйте пароль"));
assert(designPrompt.includes("Не упоминай имя, телефон или точный адрес клиента"));

console.log("training security, progress and mobile contracts passed");
