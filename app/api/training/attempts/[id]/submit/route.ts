import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { submitTrainingAttempt } from "@/lib/services/training.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  const attemptId = Number((await params).id);
  if (!Number.isInteger(attemptId) || attemptId <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = (await request.json()) as { answers?: unknown };
    return NextResponse.json(
      await submitTrainingAttempt(
        auth.actor!.userId,
        attemptId,
        body.answers as Array<{ questionId: number; optionIndex: number }>,
      ),
    );
  } catch (error) {
    return error instanceof SyntaxError
      ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 })
      : trainingError(error);
  }
}
