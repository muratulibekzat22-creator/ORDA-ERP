import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { createPartner, getPartner, getPartners } from "@/lib/services/partner.service";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth = await requirePermission("partners"); if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER) {
    const partner = await prisma.partner.findUnique({ where: { userId: Number(auth.session!.user.id) }, select: { id: true } });
    if (!partner) return NextResponse.json({ error: "Профиль цеха не найден" }, { status: 404 });
    const item = await getPartner(partner.id);
    if (!item) return NextResponse.json([]);
    return NextResponse.json([{ id: item.id, name: item.name, phone: item.phone, city: item.city, email: item.email, active: item.active, orders: item.orders.map((order) => ({ id: order.id, number: order.number, address: order.address, staircase: order.staircase, material: order.material, status: order.status, partnerPrice: order.partnerPrice, partnerPaid: order.partnerPaid, partnerBalance: order.partnerBalance, partnerPlannedReadyAt: order.partnerPlannedReadyAt, partnerComment: order.partnerComment, readyForInstallation: order.readyForInstallation, installationCompleted: order.installationCompleted, productions: order.productions, payments: order.payments.filter((payment) => payment.type === "PARTNER_PAYOUT").map((payment) => ({ id: payment.id, amount: payment.amount, method: payment.method, comment: payment.comment, operationDate: payment.operationDate })) })), stats: { totalOrders: item.stats.totalOrders, partnerPaid: item.stats.partnerPaid, partnerBalance: item.stats.partnerBalance } }]);
  }
  const items = await getPartners();
  if (auth.session!.user.role === Role.MANAGER) return NextResponse.json(items.map((item) => ({ id: item.id, name: item.name, phone: item.phone, city: item.city, email: item.email, active: item.active, stats: { totalOrders: item.stats.totalOrders } })));
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const auth = await requirePermission("partners"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Укажите название цеха" }, { status: 400 });
  return NextResponse.json(await createPartner({ name: body.name.trim(), phone: typeof body.phone === "string" ? body.phone : undefined, city: typeof body.city === "string" ? body.city : undefined, email: typeof body.email === "string" ? body.email : undefined }), { status: 201 });
}
