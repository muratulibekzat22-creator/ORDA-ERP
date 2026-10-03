import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { getChatGptOfficeAccess } from "@/lib/chatgpt-office-access";
import { requireTrainingRole, trainingError } from "@/lib/training-api";
import { recordChatGptAccessReveal } from "@/lib/services/training.service";

export async function POST(request: Request) {
  const auth = await requireTrainingRole(Role.MEASURER);
  if (auth.response) return auth.response;
  const body = await request.json().catch(() => ({}));
  if (body?.ownerNotified !== true)
    return NextResponse.json(
      { error: "Сначала предупредите владельца рабочего аккаунта" },
      { status: 400 },
    );
  const access = getChatGptOfficeAccess();
  if (!access)
    return NextResponse.json(
      { error: "Рабочий доступ ещё не настроен. Обратитесь к директору." },
      { status: 503 },
    );
  try {
    await recordChatGptAccessReveal(auth.actor!.userId);
    return NextResponse.json(access, {
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
