import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import {
  calculateStair,
  type StairMaterial,
} from "@/lib/calculator/stair-calculation";
import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
async function scopedOrder(id: number, role: Role, userId: string) {
  if (role !== Role.PARTNER)
    return prisma.order.findUnique({ where: { id }, select: { id: true } });
  const partner = await prisma.partner.findUnique({
    where: { userId: Number(userId) },
    select: { id: true },
  });
  return partner
    ? prisma.order.findFirst({
        where: { id, partnerId: partner.id },
        select: { id: true },
      })
    : null;
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    role = auth.session!.user.role as Role;
  if (
    !Number.isInteger(id) ||
    !(await scopedOrder(id, role, auth.session!.user.id))
  )
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const value = await prisma.orderCalculation.findFirst({
    where: { orderId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!value) return NextResponse.json(null);
  const result = { ...value } as Record<string, unknown>;
  if (role !== Role.DIRECTOR && role !== Role.ACCOUNTANT) {
    delete result.workshopCost;
    delete result.baseWorkshopCost;
    delete result.workshopRate;
    delete result.workshopAdjustment;
    delete result.grossDifference;
  }
  return NextResponse.json(result);
}

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    role = auth.session!.user.role as Role;
  if (
    (role !== Role.DIRECTOR && role !== Role.MANAGER) ||
    !Number.isInteger(id) ||
    !(await scopedOrder(id, role, auth.session!.user.id))
  )
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if ("workshopCost" in body && role !== Role.DIRECTOR)
      return NextResponse.json(
        { error: "Стоимость цеха может изменить только директор" },
        { status: 403 },
      );
    const calculation = calculateStair({
      material: body.material as StairMaterial,
      regularSteps: Number(body.regularSteps),
      platformEquivalents: body.platformEquivalents as number[],
      ...(body.clientPrice === undefined
        ? {}
        : { clientPrice: Number(body.clientPrice) }),
      ...(body.workshopCost === undefined
        ? {}
        : { workshopCost: Number(body.workshopCost) }),
    });
    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const requestHash = createRequestHash({ id, ...calculation });
    const key = idempotency.key ? `calculation:${id}:${idempotency.key}` : null;
    if (key) {
      const existing = await prisma.orderCalculation.findUnique({
        where: { idempotencyKey: key },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) return idempotencyConflict();
        return NextResponse.json(existing);
      }
    }
    const saved = await prisma.$transaction(async (tx) => {
      const created = await tx.orderCalculation.create({
        data: {
          orderId: id,
          ...calculation,
          createdByUserId: Number(auth.session!.user.id) || null,
          createdByName: auth.session!.user.name ?? "Система",
          idempotencyKey: key,
          requestHash,
        },
      });
      await tx.order.update({
        where: { id },
        data: {
          material: calculation.material,
          amount: calculation.clientPrice,
          partnerPrice: calculation.workshopCost,
          companyProfit: calculation.grossDifference,
          balance: {
            set:
              calculation.clientPrice -
              Number(
                (
                  await tx.order.findUniqueOrThrow({
                    where: { id },
                    select: { prepayment: true },
                  })
                ).prepayment,
              ),
          },
          partnerBalance: {
            set:
              calculation.workshopCost -
              Number(
                (
                  await tx.order.findUniqueOrThrow({
                    where: { id },
                    select: { partnerPaid: true },
                  })
                ).partnerPaid,
              ),
          },
        },
      });
      await tx.orderEvent.create({
        data: {
          orderId: id,
          title: "Сохранён расчёт лестницы",
          description: `${calculation.material}: ${calculation.equivalentSteps} эквивалентных ступеней`,
          user: auth.session!.user.name ?? "Система",
        },
      });
      return created;
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Некорректный расчёт" },
      { status: 400 },
    );
  }
}
