import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";

export type TrainingActor = { userId: number; role: Role; name: string };

export async function requireTrainingRole(...roles: Role[]) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.invalid || !session.user.id) {
    return {
      response: NextResponse.json(
        { error: "Сессия завершена", code: "SESSION_INVALID" },
        { status: 401 },
      ),
    };
  }
  const role = session.user.role as Role;
  if (!roles.includes(role)) {
    return {
      response: NextResponse.json(
        { error: "Недостаточно прав" },
        { status: 403 },
      ),
    };
  }
  return {
    actor: {
      userId: Number(session.user.id),
      role,
      name: session.user.name ?? "Сотрудник",
    } satisfies TrainingActor,
  };
}

export function trainingError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "TRAINING_NOT_FOUND")
    return NextResponse.json({ error: "Обучение не назначено" }, { status: 404 });
  if (code === "QUIZ_LOCKED")
    return NextResponse.json(
      { error: "Сначала посмотрите не менее 90% видео и подтвердите ознакомление" },
      { status: 409 },
    );
  if (code === "ACKNOWLEDGEMENT_LOCKED")
    return NextResponse.json(
      { error: "Подтверждение доступно после просмотра 90% видео" },
      { status: 409 },
    );
  if (code === "ATTEMPT_NOT_FOUND")
    return NextResponse.json({ error: "Попытка не найдена" }, { status: 404 });
  if (code === "ATTEMPT_COMPLETED")
    return NextResponse.json({ error: "Попытка уже завершена" }, { status: 409 });
  if (code === "INVALID_HEARTBEAT" || code === "INVALID_ANSWERS")
    return NextResponse.json({ error: "Проверьте отправленные данные" }, { status: 400 });
  if (code === "INVALID_OVERRIDE")
    return NextResponse.json({ error: "Укажите обязательную причину override" }, { status: 400 });
  console.error("training operation failed", error);
  return NextResponse.json({ error: "Не удалось выполнить операцию обучения" }, { status: 500 });
}
