import "dotenv/config";

import { Prisma, Role, TrainingAuditAction } from "@prisma/client";

import {
  MEASURER_COURSE,
  MEASURER_LESSONS,
  MEASURER_QUESTIONS,
} from "@/lib/training-course";
import { prisma } from "@/lib/prisma";
import { runWithSystemAccess } from "@/lib/tenant-context";

async function main() {
  const courseData = {
    ...MEASURER_COURSE,
    videoLessons: MEASURER_LESSONS as unknown as Prisma.InputJsonValue,
  };
  const course = await prisma.trainingCourse.upsert({
    where: {
      slug_version: {
        slug: MEASURER_COURSE.slug,
        version: MEASURER_COURSE.version,
      },
    },
    update: courseData,
    create: courseData,
  });

  await prisma.trainingCourse.updateMany({
    where: {
      slug: MEASURER_COURSE.slug,
      version: { not: MEASURER_COURSE.version },
    },
    data: { active: false },
  });

  for (const item of MEASURER_QUESTIONS) {
    await prisma.trainingQuestion.upsert({
      where: {
        courseId_position: { courseId: course.id, position: item.position },
      },
      update: item,
      create: { courseId: course.id, ...item },
    });
  }
  await prisma.trainingQuestion.deleteMany({
    where: {
      courseId: course.id,
      position: { notIn: MEASURER_QUESTIONS.map((item) => item.position) },
    },
  });

  const measurers = await prisma.user.findMany({
    where: { role: Role.MEASURER, active: true },
    select: { id: true },
  });
  for (const measurer of measurers) {
    await prisma.trainingAssignment.upsert({
      where: { courseId_userId: { courseId: course.id, userId: measurer.id } },
      update: {},
      create: {
        courseId: course.id,
        userId: measurer.id,
        audits: {
          create: {
            actorId: measurer.id,
            action: TrainingAuditAction.ASSIGNED,
            metadata: { source: "SYSTEM_SEED" },
          },
        },
      },
    });
  }

  console.log(
    `Training seed ready: version ${course.version}, ${MEASURER_LESSONS.length} lessons, ${MEASURER_QUESTIONS.length} questions, ${measurers.length} active measurer assignments`,
  );
}

runWithSystemAccess(main).finally(() => prisma.$disconnect());
