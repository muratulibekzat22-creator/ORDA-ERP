import { LeadNextActionType, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { parseEnum } from "@/lib/leads/domain";
import { createNextAction, leadErrorResponse } from "@/lib/services/lead.service";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = Number((await params).id), body = await request.json() as Record<string, unknown>, type = parseEnum(Object.values(LeadNextActionType), body.nextActionType);
  if (!Number.isInteger(id) || id <= 0 || !type) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  try { return NextResponse.json(await createNextAction({ clientId: id, type, at: new Date(String(body.nextActionAt)), comment: typeof body.nextActionComment === "string" ? body.nextActionComment : undefined, actor: { userId: Number(auth.session!.user.id), name: auth.session!.user.name ?? "Пользователь", role: auth.session!.user.role as Role } }), { status: 201 }); }
  catch (error) { const known = leadErrorResponse(error); return known ? NextResponse.json({ error: known.message }, { status: known.status }) : NextResponse.json({ error: "Ошибка создания действия" }, { status: 500 }); }
}
