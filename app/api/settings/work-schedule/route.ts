import { NextResponse } from "next/server";

import { getWorkScheduleSettings, updateWorkScheduleSettings } from "@/lib/services/work-schedule.service";
import { requireWorkScheduleLeadership } from "@/lib/work-schedule-access";

export async function GET() {
  const auth = await requireWorkScheduleLeadership();
  if (auth.response) return auth.response;
  try {
    return NextResponse.json(await getWorkScheduleSettings(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("work_schedule.load_failed", error);
    return NextResponse.json({ error: "Не удалось загрузить рабочий календарь" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireWorkScheduleLeadership();
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as { weeklyDayOff?: unknown };
    return NextResponse.json(await updateWorkScheduleSettings(body.weeklyDayOff, Number(auth.session!.user.id)));
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_WEEKLY_DAY_OFF")
      return NextResponse.json({ error: "Выберите корректный день недели" }, { status: 400 });
    console.error("work_schedule.save_failed", error);
    return NextResponse.json({ error: "Не удалось сохранить рабочий календарь" }, { status: 500 });
  }
}
