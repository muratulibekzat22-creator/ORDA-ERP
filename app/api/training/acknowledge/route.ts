import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { acknowledgeTraining } from "@/lib/services/training.service";

export async function POST() {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  try {
    const assignment = await acknowledgeTraining(auth.actor!.userId);
    return NextResponse.json({
      acknowledgedAt: assignment.acknowledgedAt,
      status: assignment.status,
    });
  } catch (error) {
    return trainingError(error);
  }
}
