import { OrderLifecycle, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.PARTNER) {
    return NextResponse.json(
      { error: "Раздел доступен только партнёрам" },
      { status: 403 },
    );
  }

  const partner = await prisma.partner.findFirst({
    where: { userId: Number(auth.session!.user.id), active: true, archived: false, isTest: false },
    select: { id: true },
  });
  if (!partner) {
    return NextResponse.json(
      { error: "Профиль партнёра не найден" },
      { status: 404 },
    );
  }

  const [orders, recentPayments] = await Promise.all([
    prisma.order.findMany({
      where: { partnerId: partner.id, deletedAt: null, partnerAgreedAt: { not: null }, lifecycle: { not: OrderLifecycle.CANCELLED } },
      select: {
        status: true,
        lifecycle: true,
        partnerPrice: true,
        partnerPaid: true,
        partnerBalance: true,
      },
    }),
    prisma.payment.findMany({
      where: {
        type: "PARTNER_PAYOUT",
        order: { partnerId: partner.id, deletedAt: null },
      },
      select: {
        id: true,
        amount: true,
        method: true,
        comment: true,
        operationDate: true,
        order: { select: { number: true } },
      },
      orderBy: { operationDate: "desc" },
      take: 5,
    }),
  ]);

  const totals = orders.reduce(
    (accumulator, order) => ({
      price: accumulator.price + Number(order.partnerPrice),
      paid: accumulator.paid + Number(order.partnerPaid),
      balance: accumulator.balance + Math.max(Number(order.partnerBalance), 0),
    }),
    { price: 0, paid: 0, balance: 0 },
  );

  return NextResponse.json({
    activeOrders: orders.filter((order) => order.lifecycle !== OrderLifecycle.COMPLETED && order.lifecycle !== OrderLifecycle.CANCELLED).length,
    completedOrders: orders.filter((order) => order.lifecycle === OrderLifecycle.COMPLETED).length,
    totals,
    statuses: orders.reduce<Record<string, number>>((accumulator, order) => {
      accumulator[order.status] = (accumulator[order.status] ?? 0) + 1;
      return accumulator;
    }, {}),
    recentPayments,
  });
}
