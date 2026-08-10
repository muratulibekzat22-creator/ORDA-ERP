import { NextResponse } from "next/server";
import { Role } from "@prisma/client";
import { getOrder } from "@/lib/services/order.service";
import { requirePermission } from "@/lib/server-auth";
import { canAccessOrder360 } from "@/lib/services/order360.service";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  if (
    !(await canAccessOrder360(id, {
      userId: Number(auth.session!.user.id),
      role: auth.session!.user.role as Role,
      name: auth.session!.user.name ?? "",
    }))
  )
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const order = await getOrder(id);
  return order
    ? NextResponse.json(order)
    : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
}
