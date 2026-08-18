import "dotenv/config";

import { Role, TrainingAuditAction } from "@prisma/client";

import { MEASURER_COURSE, MEASURER_QUESTIONS } from "@/lib/training-course";
import { prisma } from "@/lib/prisma";
import { runWithSystemAccess } from "@/lib/tenant-context";

async function main() {
  const course = await prisma.trainingCourse.upsert({
    where: {
      slug_version: {
        slug: MEASURER_COURSE.slug,
        version: MEASURER_COURSE.version,
      },
    },
    update: { ...MEASURER_COURSE },
    create: { ...MEASURER_COURSE },
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
    `Training seed ready: version ${course.version}, ${MEASURER_QUESTIONS.length} questions, ${measurers.length} active measurer assignments`,
  );
}

runWithSystemAccess(main).finally(() => prisma.$disconnect());
