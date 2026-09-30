import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { hasProductionPrice } from "@/lib/orders/production-price";
import { createPartner, getPartner, getPartners } from "@/lib/services/partner.service";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET(request: Request) {
  const auth = await requirePermission("partners"); if (auth.response) return auth.response;
  if (auth.session!.user.role === Role.PARTNER) {
    const partner = await prisma.partner.findFirst({ where: { userId: Number(auth.session!.user.id), active: true, archived: false, isTest: false }, select: { id: true } });
    if (!partner) return NextResponse.json({ error: "Профиль цеха не найден" }, { status: 404 });
    const item = await getPartner(partner.id);
    if (!item) return NextResponse.json([]);
    return NextResponse.json([{ id: item.id, name: item.name, phone: item.phone, city: item.city, email: item.email, active: item.active, orders: item.orders.filter((order) => order.lifecycle !== "CANCELLED").map((order) => ({ id: order.id, number: order.number, address: order.address, staircase: order.staircase, material: order.material, status: order.status, partnerPrice: hasProductionPrice(order.partnerPrice, order.partnerAgreedAt) ? order.partnerPrice : null, partnerPaid: order.partnerPaid, partnerBalance: hasProductionPrice(order.partnerPrice, order.partnerAgreedAt) ? order.partnerBalance : null, partnerPlannedReadyAt: order.partnerPlannedReadyAt, partnerComment: order.partnerComment, readyForInstallation: order.readyForInstallation, installationCompleted: order.installationCompleted, productions: order.productions, payments: order.payments.filter((payment) => payment.type === "PARTNER_PAYOUT").map((payment) => ({ id: payment.id, amount: payment.amount, method: payment.method, comment: payment.comment, operationDate: payment.operationDate })) })), stats: { totalOrders: item.stats.totalOrders, partnerPaid: item.stats.partnerPaid, partnerBalance: item.stats.partnerBalance } }]);
  }
  const { searchParams } = new URL(request.url);
  const includeArchived = auth.session!.user.role === Role.DIRECTOR && searchParams.get("view") === "all";
  const items = await getPartners({ includeArchived });
  if (auth.session!.user.role === Role.MANAGER) return NextResponse.json(items.map((item) => ({ id: item.id, name: item.name, phone: item.phone, city: item.city, email: item.email, active: item.active, stats: { totalOrders: item.stats.totalOrders } })));
  return NextResponse.json(items);
}

export async function POST(request: Request) {
  const auth = await requirePermission("partners"); if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const body = await request.json() as Record<string, unknown>;
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Укажите название цеха" }, { status: 400 });
  try {
    return NextResponse.json(await createPartner({
      name: body.name.trim(),
      phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
      city: typeof body.city === "string" ? body.city.trim() : undefined,
      email: typeof body.email === "string" ? body.email.trim() : undefined,
      contactPerson: typeof body.contactPerson === "string" ? body.contactPerson.trim() : undefined,
      accessEmail: typeof body.accessEmail === "string" ? body.accessEmail : undefined,
      accessPassword: typeof body.accessPassword === "string" ? body.accessPassword : undefined,
    }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PARTNER_ACCESS_FIELDS_REQUIRED") return NextResponse.json({ error: "Для входа укажите корректный e-mail и пароль не короче 12 символов" }, { status: 400 });
    if (error instanceof Error && error.message === "INVALID_EMAIL") return NextResponse.json({ error: "Некорректный e-mail для входа" }, { status: 400 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Этот e-mail уже используется" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось создать цех" }, { status: 500 });
  }
}
