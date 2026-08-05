import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCalculatorTariffs, redactTariffs } from "@/lib/calculator/tariffs";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER && role !== Role.ACCOUNTANT)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return NextResponse.json({ items: redactTariffs(await getCalculatorTariffs(), role) });
}
