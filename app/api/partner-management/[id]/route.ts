import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getManagedPartner, PartnerManagementError } from "@/lib/services/partner-management.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!enterTenantFromSession(auth.session)) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { return NextResponse.json(await getManagedPartner(id), { headers: { "cache-control": "no-store" } }); }
  catch (error) {
    if (error instanceof PartnerManagementError && error.message === "PARTNER_NOT_FOUND")
      return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 });
    return NextResponse.json({ error: "Не удалось загрузить партнёра" }, { status: 500 });
  }
}
