import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { recordTrainingHeartbeat } from "@/lib/services/training.service";

export async function POST(request: Request) {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(
      await recordTrainingHeartbeat(auth.actor!.userId, {
        currentTime: Number(body.currentTime),
        duration: Number(body.duration),
        playerState: String(body.playerState ?? ""),
        courseVersion: Number(body.courseVersion),
      }),
    );
  } catch (error) {
    return error instanceof SyntaxError
      ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 })
      : trainingError(error);
  }
}
