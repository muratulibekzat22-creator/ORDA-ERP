import { NextResponse } from "next/server";
import { requireMandatoryTaskSession } from "@/lib/mandatory-task-auth";
import { getFounderControl, runFounderControl } from "@/lib/services/founder-control.service";

export const maxDuration = 60;
async function founder() {
  const auth = await requireMandatoryTaskSession();
  if (auth.response) return auth;
  if ((auth.session!.user.accountRole || auth.session!.user.role) !== "DIRECTOR")
    return { response: NextResponse.json({ error: "Доступ только основателю" }, { status: 403 }) };
  return auth;
}
export async function GET() {
  const auth = await founder();
  if (auth.response) return auth.response;
  return NextResponse.json(await getFounderControl(), { headers: { "Cache-Control": "private, no-store" } });
}
export async function POST(request: Request) {
  const auth = await founder();
  if (auth.response || !auth.session) return auth.response;
  const body = await request.json().catch(() => null) as { keys?: unknown } | null;
  if (!body || (body.keys !== undefined && (!Array.isArray(body.keys) || body.keys.length > 500 || body.keys.some(k => typeof k !== "string" || k.length > 100))))
    return NextResponse.json({ error: "Некорректный список замечаний" }, { status: 400 });
  const result = await runFounderControl(Number(auth.session.user.id), body.keys as string[] | undefined);
  return NextResponse.json({ result, ...(await getFounderControl()) });
}
