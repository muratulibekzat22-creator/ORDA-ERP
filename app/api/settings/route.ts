import { NextResponse } from "next/server";

import { requireSettingsDirector } from "@/lib/settings-access";
import { getSettingsManagement, patchSettingsManagement } from "@/lib/services/settings-management.service";

export async function GET() {
  const auth = await requireSettingsDirector();
  if (auth.response) return auth.response;
  try { return NextResponse.json(await getSettingsManagement()); }
  catch { return NextResponse.json({ error: "Не удалось получить настройки" }, { status: 500 }); }
}

export async function PATCH(request: Request) {
  const auth = await requireSettingsDirector();
  if (auth.response) return auth.response;
  try { return NextResponse.json(await patchSettingsManagement(await request.json())); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "DIRECTOR_CRITICAL_PERMISSION") return NextResponse.json({ error: "У директора должны остаться права настроек и сотрудников" }, { status: 409 });
    if (code === "INVALID_PERMISSIONS") return NextResponse.json({ error: "Некорректная матрица прав" }, { status: 400 });
    if (code === "INVALID_SETTINGS") return NextResponse.json({ error: "Некорректные настройки" }, { status: 400 });
    return NextResponse.json({ error: "Не удалось сохранить настройки" }, { status: 500 });
  }
}

export const PUT = PATCH;
