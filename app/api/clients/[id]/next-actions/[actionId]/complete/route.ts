import { LeadNextActionType, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseEnum } from "@/lib/leads/domain";
import { completeNextAction, leadErrorResponse } from "@/lib/services/lead.service";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string; actionId: string }> };
export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const values = await params, clientId = Number(values.id), actionId = Number(values.actionId), body = await request.json() as Record<string, unknown>;
  const next = body.nextAction && typeof body.nextAction === "object" ? body.nextAction as Record<string, unknown> : null, type = next ? parseEnum(Object.values(LeadNextActionType), next.type) : null;
  if (![clientId, actionId].every((id) => Number.isInteger(id) && id > 0)) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { return NextResponse.json(await completeNextAction({ clientId, actionId, resultComment: typeof body.resultComment === "string" ? body.resultComment : undefined, nextAction: next && type ? { type, at: new Date(String(next.at)), comment: typeof next.comment === "string" ? next.comment : undefined } : undefined, actor: { userId: Number(auth.session!.user.id), name: auth.session!.user.name ?? "Пользователь", role: auth.session!.user.role as Role } })); }
  catch (error) { const known = leadErrorResponse(error); return known ? NextResponse.json({ error: known.message }, { status: known.status }) : NextResponse.json({ error: "Ошибка завершения действия" }, { status: 500 }); }
}
