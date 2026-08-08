import { NextResponse } from "next/server";
import { calendarActor, calendarError } from "@/lib/calendar-api";
import { setCalendarTaskState } from "@/lib/services/calendar.service";
import { requirePermission } from "@/lib/server-auth";
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) { const auth = await requirePermission("calendar"); if (auth.response) return auth.response; const id = Number((await context.params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный идентификатор" }, { status: 400 }); try { return NextResponse.json(await setCalendarTaskState(calendarActor(auth.session!), id, "cancel")); } catch (error) { return calendarError(error); } }
