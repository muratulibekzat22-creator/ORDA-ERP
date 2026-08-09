import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { canAccessLead, normalizeLeadSource } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const idOf = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id }, include: { orders: { include: { payments: { select: { amount: true } } }, orderBy: { createdAt: "desc" } }, interactions: { include: { author: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }, attachments: { select: { id: true, clientId: true, fileName: true, contentType: true, size: true, createdAt: true, uploadedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } }, leadStatusHistory: { orderBy: { createdAt: "desc" } }, nextActions: { orderBy: { createdAt: "desc" } }, managerUser: { select: { id: true, name: true } } } });
  if (!client || !canAccessLead(auth.session!.user.role as Role, Number(auth.session!.user.id), client)) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  return NextResponse.json(client);
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const body = await request.json() as Record<string, unknown>, existing = await prisma.client.findUnique({ where: { id }, select: { managerUserId: true } });
    if (!existing || !canAccessLead(auth.session!.user.role as Role, Number(auth.session!.user.id), existing)) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
    if (["stage", "status", "manager", "managerUserId", "lostReason", "lostByUserId", "lostAt"].some((key) => key in body)) return NextResponse.json({ error: "Используйте специализированный workflow endpoint", code: "MASS_ASSIGNMENT_BLOCKED" }, { status: 400 });
    const data: Prisma.ClientUpdateInput = {};
    for (const key of ["name", "phone", "whatsapp", "city", "address", "iin", "estimateNotes", "comment"] as const) if (typeof body[key] === "string") data[key] = body[key].trim();
    if (["name", "phone", "city"].some((key) => key in body && !String(body[key]).trim())) return NextResponse.json({ error: "Обязательные поля не могут быть пустыми" }, { status: 400 });
    if ("sourceCode" in body || "source" in body) { const source = normalizeLeadSource(body.sourceCode ?? body.source); if (!source) return NextResponse.json({ error: "Некорректный источник" }, { status: 400 }); data.sourceCode = source; data.source = source; }
    if ("estimatedAmount" in body) { const value = Number(body.estimatedAmount); if (!Number.isFinite(value) || value < 0) return NextResponse.json({ error: "Некорректная сумма" }, { status: 400 }); data.estimatedAmount = String(value); data.amount = String(value); }
    return NextResponse.json(await prisma.client.update({ where: { id }, data }));
  } catch (error) { return error instanceof SyntaxError ? NextResponse.json({ error: "Некорректный JSON" }, { status: 400 }) : NextResponse.json({ error: "Ошибка обновления заявки" }, { status: 500 }); }
}

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("clients"); if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = idOf((await params).id); if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const client = await prisma.client.findUnique({ where: { id }, select: {
    managerUserId: true,
    leadConversion: { select: { id: true } },
    _count: { select: { orders: true, attachments: true, calendarTasks: true, measurements: true, documents: true } },
  } });
  if (!client || !canAccessLead(role, Number(auth.session!.user.id), client)) return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  const linkedRecords = Object.values(client._count).reduce((sum, count) => sum + count, 0) + (client.leadConversion ? 1 : 0);
  if (linkedRecords) return NextResponse.json({ error: "Заявка уже связана с заказом, замером, документом, календарём или файлами и не может быть удалена без потери рабочих данных", code: "CLIENT_HAS_BUSINESS_RECORDS" }, { status: 409 });
  try {
    await prisma.$transaction(async (tx) => {
      // Calculations and proposals are part of the lead draft itself. Remove them
      // in dependency order so a newly registered lead can really be deleted.
      await tx.priceApprovalRequest.deleteMany({ where: { clientId: id } });
      await tx.commercialProposal.deleteMany({ where: { clientId: id } });
      await tx.leadCalculation.deleteMany({ where: { clientId: id } });
      await tx.client.delete({ where: { id } });
    });
    return new NextResponse(null, { status: 204 });
  } catch {
    return NextResponse.json({ error: "Заявка содержит связанные рабочие данные и не может быть удалена", code: "CLIENT_HAS_BUSINESS_RECORDS" }, { status: 409 });
  }
}
