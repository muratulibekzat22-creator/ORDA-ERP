import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { reconcileOrderFinance } from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";

export async function POST(request: Request) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.ACCOUNTANT) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const body = await request.json().catch(() => null) as { orderId?: unknown; repair?: unknown } | null;
  const orderId = Number(body?.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) return NextResponse.json({ error: "Некорректный заказ" }, { status: 400 });
  return NextResponse.json(await reconcileOrderFinance(orderId, body?.repair === true));
}
