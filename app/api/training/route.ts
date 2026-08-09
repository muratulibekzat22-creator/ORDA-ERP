import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { getMyTraining } from "@/lib/services/training.service";

export async function GET() {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await getMyTraining(auth.actor!.userId), {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    return trainingError(error);
  }
}
