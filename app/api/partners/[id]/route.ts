import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { hasProductionPrice } from "@/lib/orders/production-price";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { deletePartner, getPartner, updatePartner } from "@/lib/services/partner.service";

type Context = { params: Promise<{ id: string }> };
const validId = (value: string) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  const id = validId((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const role = auth.session!.user.role as Role;
  if (role === Role.PARTNER && !await prisma.partner.findFirst({ where: { id, userId: Number(auth.session!.user.id) }, select: { id: true } })) return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 });
  const partner = await getPartner(id);
  if (!partner) return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 });
  if (role === Role.MANAGER) return NextResponse.json({ id: partner.id, name: partner.name, phone: partner.phone, city: partner.city, email: partner.email, active: partner.active });
  if (role === Role.PARTNER) return NextResponse.json({ id: partner.id, name: partner.name, phone: partner.phone, city: partner.city, email: partner.email, active: partner.active, orders: partner.orders.filter((order) => order.lifecycle !== "CANCELLED").map((order) => ({ id: order.id, number: order.number, status: order.status, partnerPrice: hasProductionPrice(order.partnerPrice, order.partnerAgreedAt) ? order.partnerPrice : null, partnerPaid: order.partnerPaid, partnerBalance: hasProductionPrice(order.partnerPrice, order.partnerAgreedAt) ? order.partnerBalance : null })) });
  return NextResponse.json(partner);
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = validId((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const body = await request.json() as Record<string, unknown>;
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "Некорректные данные" }, { status: 400 });
  try { return NextResponse.json(await updatePartner(id, {
    name: body.name.trim(),
    phone: typeof body.phone === "string" ? body.phone.trim() : undefined,
    city: typeof body.city === "string" ? body.city.trim() : undefined,
    email: typeof body.email === "string" ? body.email.trim() : undefined,
    contactPerson: typeof body.contactPerson === "string" ? body.contactPerson.trim() : undefined,
    active: typeof body.active === "boolean" ? body.active : undefined,
    accessEmail: typeof body.accessEmail === "string" ? body.accessEmail : undefined,
    accessPassword: typeof body.accessPassword === "string" ? body.accessPassword : undefined,
  })); }
  catch (error) {
    if (error instanceof Error && error.message === "PARTNER_NOT_FOUND") return NextResponse.json({ error: "Цех не найден" }, { status: 404 });
    if (error instanceof Error && error.message === "PARTNER_ACCESS_FIELDS_REQUIRED") return NextResponse.json({ error: "Для входа укажите корректный e-mail и пароль не короче 12 символов" }, { status: 400 });
    if (error instanceof Error && error.message === "INVALID_EMAIL") return NextResponse.json({ error: "Некорректный e-mail для входа" }, { status: 400 });
    if (error instanceof Error && "code" in error && error.code === "P2002") return NextResponse.json({ error: "Этот e-mail уже используется" }, { status: 409 });
    return NextResponse.json({ error: "Не удалось сохранить цех" }, { status: 500 });
  }
}

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = validId((await params).id);
  if (!id) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try { await deletePartner(id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка удаления" }, { status: 409 }); }
}
