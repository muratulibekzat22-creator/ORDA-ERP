import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { grantTrainingOverride } from "@/lib/services/training.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const auth = await requireTrainingRole(Role.DIRECTOR);
  if (auth.response) return auth.response;
  const assignmentId = Number((await params).id);
  if (!Number.isInteger(assignmentId) || assignmentId <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const assignment = await grantTrainingOverride(
      auth.actor!.userId,
      assignmentId,
      typeof body.reason === "string" ? body.reason : "",
      Number(body.hours ?? 24),
    );
    return NextResponse.json({
      overrideExpiresAt: assignment.overrideExpiresAt,
      overrideReason: assignment.overrideReason,
    });
  } catch (error) {
    return error instanceof SyntaxError
      ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 })
      : trainingError(error);
  }
}
