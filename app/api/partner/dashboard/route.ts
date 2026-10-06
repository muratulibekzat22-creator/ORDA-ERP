import {
  OrderLifecycle,
  PartnerSettlementOperationType,
  Role,
} from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, idempotencyConflict, readIdempotencyKey } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import {
  PartnerManagementError,
  submitPartnerPayoutAcknowledgement,
} from "@/lib/services/partner-management.service";

const isPartnerControlSnapshot = (value: unknown) =>
  Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).kind === "PARTNER_CONTROL",
  );

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
        partnerRelation: {
          select: {
            operations: {
              where: { type: PartnerSettlementOperationType.COMPANY_TO_PARTNER },
              select: {
                id: true,
                amount: true,
                operationDate: true,
                method: true,
                account: true,
                comment: true,
                status: true,
                createdAt: true,
              },
              orderBy: [{ createdAt: "desc" }, { id: "desc" }],
              take: 20,
            },
          },
        },
        client: { select: { id: true, name: true, phone: true, city: true } },
        measurements: {
          where: { completedAt: { not: null } },
          select: { id: true, status: true, completedAt: true, visitDate: true, stepsCount: true, measurer: true, completedSnapshot: true },
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
      payoutAcknowledgements: order.partnerRelation?.operations
        .filter((operation) => operation.account?.startsWith("PARTNER_ACKNOWLEDGEMENT_"))
        .map((operation) => ({
          ...operation,
          amount: Number(operation.amount),
          status: operation.account === "PARTNER_ACKNOWLEDGEMENT_PENDING"
            ? "PENDING"
            : operation.account === "PARTNER_ACKNOWLEDGEMENT_REJECTED"
              ? "REJECTED"
              : operation.status,
        })) ?? [],
      measurements: order.measurements.map((measurement) => ({
        id: measurement.id,
        status: measurement.status,
        completedAt: measurement.completedAt,
        visitDate: measurement.visitDate,
        stepsCount: measurement.stepsCount,
        measurer: measurement.measurer,
        isPartnerControl: isPartnerControlSnapshot(measurement.completedSnapshot),
        sheetHref: `/api/measurements/${measurement.id}/sheet`,
      })),
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

export async function POST(request: Request) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.PARTNER)
    return NextResponse.json({ error: "Раздел доступен только партнёрам" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const orderId = Number(body.orderId);
    const amount = Number(body.amount);
    const method = typeof body.method === "string" ? body.method.trim() : "";
    const operationDate = typeof body.operationDate === "string" && body.operationDate
      ? new Date(`${body.operationDate}T12:00:00+05:00`)
      : new Date();
    if (!Number.isInteger(orderId) || orderId <= 0 || !Number.isFinite(amount) || amount <= 0 || !method)
      return NextResponse.json({ error: "Проверьте заказ, сумму и способ выплаты" }, { status: 400 });
    if (Number.isNaN(operationDate.getTime()))
      return NextResponse.json({ error: "Некорректная дата выплаты" }, { status: 400 });
    const comment = typeof body.comment === "string" ? body.comment.trim() : undefined;
    const requestHash = createRequestHash({ orderId, amount, method, operationDate: operationDate.toISOString(), comment: comment || null });
    const result = await submitPartnerPayoutAcknowledgement({
      orderId,
      amount,
      method,
      operationDate,
      comment,
      idempotencyKey: idempotency.key,
      requestHash,
    }, {
      userId: Number(auth.session!.user.id),
      role: Role.PARTNER,
      name: auth.session!.user.name?.trim() || "Подрядчик",
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof PartnerManagementError) {
      if (error.message === "IDEMPOTENCY_CONFLICT") return idempotencyConflict();
      const notFound = error.message === "RELATION_NOT_FOUND";
      const conflict = ["PAYOUT_ACKNOWLEDGEMENT_EXCEEDS_BALANCE", "PARTNER_COST_NOT_AGREED"].includes(error.message);
      return NextResponse.json({ error: error.message }, { status: notFound ? 404 : conflict ? 409 : error.message === "FORBIDDEN" ? 403 : 400 });
    }
    console.error("Не удалось сохранить подтверждение выплаты подрядчика", error);
    return NextResponse.json({ error: "Не удалось сохранить выплату. Повторите попытку." }, { status: 500 });
  }
}
