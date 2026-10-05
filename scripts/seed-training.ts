import "dotenv/config";

import { prisma } from "@/lib/prisma";
import { syncMeasurerTrainingProgram } from "@/lib/services/training.service";
import { runWithSystemAccess } from "@/lib/tenant-context";

async function main() {
  const result = await runWithSystemAccess(() => syncMeasurerTrainingProgram());
  console.log(
    `Training seed ready: version ${result.version}, ${result.lessons} lessons, ${result.questions} questions, ${result.assignments} active measurer assignments`,
  );
}

main().finally(() => prisma.$disconnect());
