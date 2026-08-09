import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MEASURER_COURSE, MEASURER_QUESTIONS } from "@/lib/training-course";
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

assert.equal(MEASURER_COURSE.version, 1);
assert.equal(MEASURER_COURSE.youtubeVideoId, "jBk1-0ku2PY");
assert.equal(MEASURER_COURSE.requiredCoverage, 90);
assert.equal(MEASURER_COURSE.passScorePercent, 80);
assert.equal(MEASURER_QUESTIONS.length, 15);
for (const question of MEASURER_QUESTIONS) {
  assert.equal(question.options.length, 4);
  assert(question.correctOption >= 0 && question.correctOption < 4);
}
assert.equal((12 / 15) * 100 >= 80, true);
assert.equal((11 / 15) * 100 >= 80, false);

const service = readFileSync("lib/services/training.service.ts", "utf8");
const trainingApi = readFileSync("lib/training-api.ts", "utf8");
const measurement = readFileSync("lib/services/measurement.service.ts", "utf8");
const workspace = readFileSync("components/training/TrainingWorkspace.tsx", "utf8");
const shell = readFileSync("components/layout/RouteShell.tsx", "utf8");
const proxy = readFileSync("proxy.ts", "utf8");
const employeeUpdate = readFileSync("app/api/employees/[id]/route.ts", "utf8");
const employeeService = readFileSync("lib/services/employee.service.ts", "utf8");
const nextConfig = readFileSync("next.config.ts", "utf8");

assert(service.includes("select: { id: true, position: true, question: true, options: true }"), "quiz read projection can expose answers");
assert(!readFileSync("app/api/training/attempts/route.ts", "utf8").includes("correctOption"), "quiz route exposes answers");
assert(service.includes("attempt.assignment.userId !== userId"), "attempt IDOR guard missing");
assert(service.includes("unique.get(question.id) === question.correctOption"), "server-side scoring missing");
assert(trainingApi.includes("Role.MEASURER") || trainingApi.includes("roles.includes"));
assert(measurement.includes("hasTrainingClearance") && measurement.includes("TRAINING_REQUIRED"));
assert(workspace.includes("https://www.youtube.com/iframe_api") && workspace.includes("7_000"));
assert(
  nextConfig.includes("script-src 'self' 'unsafe-inline' https://www.youtube.com") &&
    nextConfig.includes("frame-src https://www.youtube.com https://www.youtube-nocookie.com"),
  "Content Security Policy blocks the embedded YouTube player",
);
assert(workspace.includes("overflow-x-hidden") && workspace.includes("aspect-video"));
assert(shell.includes('"/training"') && shell.includes('role === "MEASURER"'));
assert(proxy.includes('firstSegment === "training"'));
assert(employeeService.includes("ensureCurrentMeasurerTraining") && employeeUpdate.includes("ensureCurrentMeasurerTraining"));

console.log("training security, progress and mobile contracts passed");
