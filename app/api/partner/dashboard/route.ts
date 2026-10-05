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
    select: { id: true, name: true, phone: true },
  });
  if (!partner) {
    return NextResponse.json(
      { error: "Профиль партнёра не найден" },
      { status: 404 },
    );
  }

  const [orders, recentPayments] = await Promise.all([
    prisma.order.findMany({
      where: { partnerId: partner.id, deletedAt: null, lifecycle: { not: OrderLifecycle.CANCELLED } },
      select: {
        id: true,
        number: true,
        status: true,
        lifecycle: true,
        address: true,
        staircase: true,
        material: true,
        mapUrl: true,
        orderReceivedAt: true,
        promisedAt: true,
        productionDeadline: true,
        frameComment: true,
        railingType: true,
        supportType: true,
        color: true,
        lighting: true,
        lightingDetails: true,
        cladding: true,
        claddingDetails: true,
        additionalDetails: true,
        designStyle: true,
        designNotes: true,
        partnerPrice: true,
        partnerAgreedAt: true,
        partnerPaid: true,
        partnerBalance: true,
        partnerPlannedReadyAt: true,
        partnerComment: true,
        readyForInstallation: true,
        installationCompleted: true,
        client: { select: { id: true, name: true, phone: true, city: true } },
        measurements: {
          where: { completedAt: { not: null } },
          select: { id: true, status: true, completedAt: true, visitDate: true, stepsCount: true, measurer: true },
          orderBy: { completedAt: "desc" },
        },
      },
      orderBy: [{ lifecycle: "asc" }, { productionDeadline: "asc" }, { id: "desc" }],
      take: 500,
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
    (accumulator, order) =>
      order.partnerAgreedAt
        ? {
            price: accumulator.price + Number(order.partnerPrice),
            paid: accumulator.paid + Number(order.partnerPaid),
            balance:
              accumulator.balance + Math.max(Number(order.partnerBalance), 0),
          }
        : accumulator,
    { price: 0, paid: 0, balance: 0 },
  );

  return NextResponse.json({
    partner: { id: partner.id, name: partner.name, phone: partner.phone },
    orders: orders.map((order) => ({
      id: order.id, number: order.number, status: order.status, lifecycle: order.lifecycle,
      client: order.client, address: order.address, staircase: order.staircase, material: order.material,
      mapUrl: order.mapUrl, orderReceivedAt: order.orderReceivedAt, promisedAt: order.promisedAt,
      productionDeadline: order.productionDeadline, frameComment: order.frameComment,
      railingType: order.railingType, supportType: order.supportType, color: order.color,
      lighting: order.lighting, lightingDetails: order.lightingDetails,
      cladding: order.cladding, claddingDetails: order.claddingDetails,
      additionalDetails: order.additionalDetails, designStyle: order.designStyle, designNotes: order.designNotes,
      partnerPrice: Number(order.partnerPrice), partnerAgreedAt: order.partnerAgreedAt,
      partnerPaid: Number(order.partnerPaid), partnerBalance: Math.max(Number(order.partnerBalance), 0),
      partnerPlannedReadyAt: order.partnerPlannedReadyAt, partnerComment: order.partnerComment,
      readyForInstallation: order.readyForInstallation, installationCompleted: order.installationCompleted,
      measurements: order.measurements.map((measurement) => ({ ...measurement, sheetHref: `/api/measurements/${measurement.id}/sheet` })),
    })),
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
