import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { startTrainingAttempt } from "@/lib/services/training.service";

export async function POST(request: Request) {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  try {
    const body = (await request.json().catch(() => ({}))) as { lessonKey?: unknown };
    return NextResponse.json(await startTrainingAttempt(
      auth.actor!.userId,
      typeof body.lessonKey === "string" ? body.lessonKey : undefined,
    ), {
      status: 201,
    });
  } catch (error) {
    return trainingError(error);
  }
}
