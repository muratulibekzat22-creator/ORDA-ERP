ALTER TABLE "TrainingCourse"
ADD COLUMN "videoLessons" JSONB;

ALTER TABLE "TrainingAssignment"
ADD COLUMN "lessonProgress" JSONB NOT NULL DEFAULT '{}';
