import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { canAccessLead } from "@/lib/leads/domain";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

const types = ["DESIGN_3D_DONE", "DESIGN_3D_SKIPPED"] as const;

async function accessibleClient(id: number, role: Role, userId: number) {
  const client = await prisma.client.findFirst({
    where: { id, active: true, deletedAt: null },
    select: { id: true, managerUserId: true },
  });
  return client && canAccessLead(role, userId, client) ? client : null;
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = Number((await context.params).id);
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  const userId = Number(auth.session!.user.id);
  if (!Number.isInteger(id) || !await accessibleClient(id, role, userId))
    return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  const latest = await prisma.leadActivity.findFirst({
    where: { clientId: id, type: { in: [...types] } },
    orderBy: { createdAt: "desc" },
    select: { type: true, comment: true, createdAt: true, authorName: true },
  });
  return NextResponse.json({
    status: latest?.type === "DESIGN_3D_DONE" ? "DONE" : latest?.type === "DESIGN_3D_SKIPPED" ? "SKIPPED" : "PENDING",
    latest,
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = Number((await context.params).id);
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  const userId = Number(auth.session!.user.id);
  if (!Number.isInteger(id) || !await accessibleClient(id, role, userId))
    return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  const body = await request.json().catch(() => null) as { status?: unknown; comment?: unknown } | null;
  if (body?.status !== "DONE" && body?.status !== "SKIPPED")
    return NextResponse.json({ error: "Выберите результат 3D-проекта" }, { status: 400 });
  const activity = await prisma.leadActivity.create({
    data: {
      clientId: id,
      type: body.status === "DONE" ? "DESIGN_3D_DONE" : "DESIGN_3D_SKIPPED",
      comment: typeof body.comment === "string" && body.comment.trim() ? body.comment.trim().slice(0, 1000) : body.status === "DONE" ? "3D-проект показан клиенту" : "3D-проект не использован",
      authorId: userId,
      authorName: auth.session!.user.name ?? "Сотрудник",
    },
  });
  return NextResponse.json({ status: body.status, activity }, { status: 201 });
}
