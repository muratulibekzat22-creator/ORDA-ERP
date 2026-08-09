CREATE TYPE "TrainingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'READY_FOR_TEST', 'FAILED', 'PASSED');
CREATE TYPE "TrainingAttemptStatus" AS ENUM ('IN_PROGRESS', 'FAILED', 'PASSED');
CREATE TYPE "TrainingAuditAction" AS ENUM ('ASSIGNED', 'ACKNOWLEDGED', 'OVERRIDE_GRANTED', 'QUIZ_SUBMITTED');

CREATE TABLE "TrainingCourse" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "targetRole" "Role" NOT NULL,
    "videoLanguage" TEXT NOT NULL,
    "quizLanguage" TEXT NOT NULL,
    "youtubeVideoId" TEXT NOT NULL,
    "passScorePercent" INTEGER NOT NULL DEFAULT 80,
    "requiredCoverage" INTEGER NOT NULL DEFAULT 90,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingQuestion" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "options" JSONB NOT NULL,
    "correctOption" INTEGER NOT NULL,
    "explanation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingQuestion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAssignment" (
    "id" SERIAL NOT NULL,
    "courseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "TrainingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "progressPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "watchedRanges" JSONB NOT NULL DEFAULT '[]',
    "videoDuration" DOUBLE PRECISION,
    "lastVideoTime" DOUBLE PRECISION,
    "lastHeartbeatAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "bestScore" INTEGER NOT NULL DEFAULT 0,
    "bestPercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "passedAt" TIMESTAMP(3),
    "lastViewedAt" TIMESTAMP(3),
    "overrideById" INTEGER,
    "overrideReason" TEXT,
    "overrideExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrainingAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAttempt" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "courseVersion" INTEGER NOT NULL,
    "status" "TrainingAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "answers" JSONB,
    "score" INTEGER,
    "percent" DOUBLE PRECISION,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "TrainingAttempt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrainingAudit" (
    "id" SERIAL NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "actorId" INTEGER NOT NULL,
    "action" "TrainingAuditAction" NOT NULL,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrainingAudit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TrainingCourse_slug_version_key" ON "TrainingCourse"("slug", "version");
CREATE INDEX "TrainingCourse_targetRole_active_mandatory_idx" ON "TrainingCourse"("targetRole", "active", "mandatory");
CREATE UNIQUE INDEX "TrainingQuestion_courseId_position_key" ON "TrainingQuestion"("courseId", "position");
CREATE INDEX "TrainingQuestion_courseId_idx" ON "TrainingQuestion"("courseId");
CREATE UNIQUE INDEX "TrainingAssignment_courseId_userId_key" ON "TrainingAssignment"("courseId", "userId");
CREATE INDEX "TrainingAssignment_userId_status_idx" ON "TrainingAssignment"("userId", "status");
CREATE INDEX "TrainingAssignment_courseId_status_idx" ON "TrainingAssignment"("courseId", "status");
CREATE INDEX "TrainingAttempt_assignmentId_startedAt_idx" ON "TrainingAttempt"("assignmentId", "startedAt");
CREATE INDEX "TrainingAudit_assignmentId_createdAt_idx" ON "TrainingAudit"("assignmentId", "createdAt");
CREATE INDEX "TrainingAudit_actorId_createdAt_idx" ON "TrainingAudit"("actorId", "createdAt");

ALTER TABLE "TrainingQuestion" ADD CONSTRAINT "TrainingQuestion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAssignment" ADD CONSTRAINT "TrainingAssignment_overrideById_fkey" FOREIGN KEY ("overrideById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrainingAttempt" ADD CONSTRAINT "TrainingAttempt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAudit" ADD CONSTRAINT "TrainingAudit_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "TrainingAssignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TrainingAudit" ADD CONSTRAINT "TrainingAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
