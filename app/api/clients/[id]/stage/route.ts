import { LeadLostReason, LeadNextActionType, LeadStage, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseEnum } from "@/lib/leads/domain";
import { leadErrorResponse, transitionLead } from "@/lib/services/lead.service";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>, stage = parseEnum(Object.values(LeadStage), body.stage);
    if (!stage) return NextResponse.json({ error: "Некорректная стадия" }, { status: 400 });
    const action = body.nextAction && typeof body.nextAction === "object" ? body.nextAction as Record<string, unknown> : null;
    const actionType = action ? parseEnum(Object.values(LeadNextActionType), action.type) : null;
    const result = await transitionLead({ clientId: id, stage, comment: typeof body.comment === "string" ? body.comment : undefined, lostReason: parseEnum(Object.values(LeadLostReason), body.lostReason) ?? undefined, lostComment: typeof body.lostComment === "string" ? body.lostComment : undefined, nextAction: action && actionType ? { type: actionType, at: new Date(String(action.at)), comment: typeof action.comment === "string" ? action.comment : undefined } : undefined, actor: { userId: Number(auth.session!.user.id), name: auth.session!.user.name ?? "Пользователь", role: auth.session!.user.role as Role } });
    return NextResponse.json(result);
  } catch (error) { const known = leadErrorResponse(error); return known ? NextResponse.json({ error: known.message }, { status: known.status }) : NextResponse.json({ error: "Ошибка смены стадии" }, { status: 500 }); }
}
