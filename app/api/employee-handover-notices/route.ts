import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { requireTenantIdentity } from "@/lib/tenant-context";

export async function GET() {
  const auth = await requirePermission("calendar");
  if (auth.response) return auth.response;
  const userId = Number(auth.session!.user.id);
  const companyId = requireTenantIdentity().companyId;
  const notices = await prisma.employeeHandoverNotice.findMany({ where: { userId, readAt: null, handover: { companyId, status: "COMPLETED" } }, select: { id: true, text: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 });
  return NextResponse.json(notices, { headers: { "Cache-Control": "private, no-store" } });
}

export async function PATCH(request: Request) {
  const auth = await requirePermission("calendar");
  if (auth.response) return auth.response;
  const { id } = await request.json() as { id?: number };
  if (!Number.isSafeInteger(id) || !id || id < 1) return NextResponse.json({ error: "Неверное уведомление" }, { status: 400 });
  const result = await prisma.employeeHandoverNotice.updateMany({ where: { id, userId: Number(auth.session!.user.id), handover: { companyId: requireTenantIdentity().companyId } }, data: { readAt: new Date() } });
  return NextResponse.json({ read: result.count === 1 });
}
