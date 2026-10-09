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
import {
  preferredTrainingLessonKey,
  trainingLessonCompletionState,
} from "@/lib/training-navigation";
import { normalizeYouTubeVideoId, trainingVideoErrorMessage } from "@/lib/training-video";

const navigationLessons = [
  { key: "lesson-1", videoCompleted: true, lessonCompleted: false },
  { key: "lesson-2", videoCompleted: false, lessonCompleted: false },
];
assert.equal(preferredTrainingLessonKey(navigationLessons, ""), "lesson-1");
assert.equal(preferredTrainingLessonKey(navigationLessons, "lesson-2"), "lesson-2");
assert.equal(
  preferredTrainingLessonKey([{ ...navigationLessons[0], lessonCompleted: true }, navigationLessons[1]], ""),
  "lesson-2",
);
assert.deepEqual(
  trainingLessonCompletionState({ progressPercent: 90, requiredCoverage: 90, questionsCount: 3, quizPassed: false }),
  { videoCompleted: true, testRequired: true, testAvailable: true, lessonCompleted: false },
);
assert.deepEqual(
  trainingLessonCompletionState({ progressPercent: 100, requiredCoverage: 90, questionsCount: 0, quizPassed: false }),
  { videoCompleted: true, testRequired: false, testAvailable: false, lessonCompleted: true },
);
assert.equal(normalizeYouTubeVideoId(" XTDgF1xeqR8 "), "XTDgF1xeqR8");
assert.equal(normalizeYouTubeVideoId(undefined), "");
assert.equal(normalizeYouTubeVideoId("bad"), "");
assert.match(trainingVideoErrorMessage(100), /удалено|закрыто/);
for (const lesson of [MEASURER_LESSONS[0], MEASURER_LESSONS[1], MEASURER_LESSONS[2], MEASURER_LESSONS.at(-1)]) {
  assert(lesson);
  assert.equal(normalizeYouTubeVideoId(lesson.youtubeVideoId), lesson.youtubeVideoId, `${lesson.key} has an invalid video id`);
}

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
assert.deepEqual(
  acceptedHeartbeatRange({ previousTime: 83, previousAt: new Date(0), currentTime: 90, receivedAt: new Date(7_000), playerState: "ENDED" }),
  [83, 90],
  "the final watched segment must be persisted when YouTube ends",
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

assert.equal(MEASURER_COURSE.version, 3);
assert.equal(MEASURER_COURSE.youtubeVideoId, "jBk1-0ku2PY");
assert.equal(MEASURER_COURSE.requiredCoverage, 90);
assert.equal(MEASURER_COURSE.passScorePercent, 85);
assert.equal(MEASURER_LESSONS.length, 10);
assert.equal(new Set(MEASURER_LESSONS.map((lesson) => lesson.key)).size, 10);
assert.equal(new Set(MEASURER_LESSONS.map((lesson) => lesson.youtubeVideoId)).size, 10);
assert(MEASURER_LESSONS.some((lesson) => lesson.youtubeVideoId === "Vy9FQd3a1Og"));
assert.equal(MEASURER_QUESTIONS.length, 24);
const lessonKeys = new Set(MEASURER_LESSONS.map((lesson) => lesson.key));
for (const question of MEASURER_QUESTIONS) {
  assert.equal(question.options.length, 4);
  assert(question.correctOption >= 0 && question.correctOption < 4);
  assert(lessonKeys.has(question.lessonKey), `unknown lesson for question ${question.position}`);
}
for (const lesson of MEASURER_LESSONS)
  assert(MEASURER_QUESTIONS.some((question) => question.lessonKey === lesson.key), `${lesson.key} has no quiz mapping`);

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

assert(service.includes("select: { id: true, position: true, question: true, options: true }"), "quiz read projection can expose answers");
assert(!readFileSync("app/api/training/attempts/route.ts", "utf8").includes("correctOption"), "quiz route exposes answers");
assert(service.includes("attempt.assignment.userId !== userId"), "attempt IDOR guard missing");
assert(service.includes("unique.get(question.id) === question.correctOption"), "server-side scoring missing");
assert(trainingApi.includes("Role.MEASURER") || trainingApi.includes("roles.includes"));
assert(measurement.includes("hasTrainingClearance") && measurement.includes("TRAINING_REQUIRED"));
assert(workspace.includes("https://www.youtube.com/iframe_api") && workspace.includes("7_000"));
assert(workspace.includes("course.lessons.map") && workspace.includes("lessonKey"));
assert(workspace.includes("Тест по выбранному видео") && workspace.includes("Пройти тест по видео"));
assert(workspace.includes("Продолжить тест") && workspace.includes("Предыдущий урок") && workspace.includes("Следующий урок"), "lesson return/resume controls are missing");
assert(workspace.includes("playerContainer") && workspace.includes("document.createElement(\"div\")") && !workspace.includes("key={videoId}"), "YouTube must not replace a React-owned keyed node");
assert(workspace.includes("training-last-lesson-") && workspace.includes('searchParams.set("lesson"'), "selected lesson is not restored after reload/login");
assert(workspace.includes('playerState: "ENDED"') && workspace.includes("Перейти к тесту"), "video completion must stay in the lesson and expose the quiz action");
assert(!workspace.includes("router.push") && !workspace.includes("router.replace"), "video completion must not navigate away from the lesson");
assert(workspace.includes("heartbeatQueues") && workspace.includes("playerLessonKey"), "lesson switching can race with progress persistence");
assert(workspace.includes("trainingVideoErrorMessage") && workspace.includes('role="alert"'), "video failures must be contained inside the lesson");
assert(service.includes("quizInProgress") && service.includes("lessonCompleted") && service.includes("completedAttempts"), "per-lesson video and quiz states are not restored independently");
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
assert(chatGptAccessApi.includes("Role.MEASURER") && chatGptAccessApi.includes('"Cache-Control": "private, no-store, max-age=0"'));
assert(chatGptAccessApi.includes("ownerNotified") && service.includes("CHATGPT_ACCESS_REVEALED"));
assert(chatGptAccessCard.includes("Получить рабочий логин и пароль") && chatGptAccessCard.includes("Не фотографируйте пароль"));
assert(designPrompt.includes("Не упоминай имя, телефон или точный адрес клиента"));

console.log("training security, progress and mobile contracts passed");
