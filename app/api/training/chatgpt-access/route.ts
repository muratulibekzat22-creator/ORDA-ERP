import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole, trainingError } from "@/lib/training-api";

export async function POST(request: Request) {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  try {
    await request.json().catch(() => ({}));
    return NextResponse.json({ error: "Общий пароль отключён. Используйте персональный доступ, выданный директором." }, {
      status: 410,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        Pragma: "no-cache",
        Vary: "Cookie",
      },
    });
  } catch (error) {
    return trainingError(error);
  }
}
