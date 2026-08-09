import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { startTrainingAttempt } from "@/lib/services/training.service";

export async function POST() {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await startTrainingAttempt(auth.actor!.userId), {
      status: 201,
    });
  } catch (error) {
    return trainingError(error);
  }
}
