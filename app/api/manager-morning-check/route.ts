import { Role } from "@prisma/client";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import {
  completeManagerMorningReview,
  getManagerMorningReviewState,
} from "@/lib/services/manager-morning-review.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

async function managerSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user)
    return { response: NextResponse.json({ error: "Требуется авторизация" }, { status: 401 }) };
  if (session.user.role !== Role.MANAGER)
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return { userId: Number(session.user.id), session };
}

export async function GET() {
  const auth = await managerSession();
  if ("response" in auth) return auth.response;
  if (!enterTenantFromSession(auth.session))
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  try {
    return NextResponse.json(await getManagerMorningReviewState(auth.userId));
  } catch (cause) {
    console.error(
      "[manager-morning-check] load failed",
      cause instanceof Error ? cause.message : "UNKNOWN",
    );
    return NextResponse.json({ error: "Не удалось проверить заказы" }, { status: 500 });
  }
}

export async function POST() {
  const auth = await managerSession();
  if ("response" in auth) return auth.response;
  if (!enterTenantFromSession(auth.session))
    return NextResponse.json({ error: "Требуется авторизация" }, { status: 401 });
  try {
    return NextResponse.json(await completeManagerMorningReview(auth.userId));
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : "UNKNOWN";
    if (code === "INVENTORY_UNAVAILABLE")
      return NextResponse.json(
        { error: "Инвентаризация компании временно недоступна. Проверка не блокирует кабинет." },
        { status: 409 },
      );
    if (code === "OWNERSHIP_REQUIRED")
      return NextResponse.json(
        { error: "Найдены заказы без корректной привязки менеджера. Директору отправлена диагностика." },
        { status: 409 },
      );
    return NextResponse.json({ error: "Не удалось завершить проверку" }, { status: 500 });
  }
}
