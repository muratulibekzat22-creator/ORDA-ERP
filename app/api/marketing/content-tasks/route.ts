import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import {
  getMarketingContentTasks,
  MarketingContentError,
  updateMarketingContentTask,
  type MarketingContentActor,
} from "@/lib/services/marketing-content.service";

function actor(session: {
  user: { id: string; name?: string | null; role: string };
}): MarketingContentActor {
  return {
    userId: Number(session.user.id),
    name: session.user.name ?? "ORDA",
    role: session.user.role as Role,
  };
}

function failure(error: unknown) {
  if (error instanceof MarketingContentError) {
    if (error.message === "FORBIDDEN")
      return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (error.message === "NOT_FOUND")
      return NextResponse.json({ error: "Задача не найдена" }, { status: 404 });
    return NextResponse.json({ error: "Проверьте данные" }, { status: 400 });
  }
  return NextResponse.json({ error: "Не удалось обработать задачу" }, { status: 500 });
}

export async function GET() {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await getMarketingContentTasks(actor(auth.session!)));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const taskId = Number(body.taskId);
    if (!Number.isInteger(taskId) || taskId <= 0)
      return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
    return NextResponse.json(
      await updateMarketingContentTask(taskId, body, actor(auth.session!)),
    );
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    return failure(error);
  }
}
