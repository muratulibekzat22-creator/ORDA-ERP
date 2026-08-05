import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import {
  canTransitionOrderStatus,
  normalizeOrderStatus,
} from "@/lib/orders/lifecycle";
import { prisma } from "@/lib/prisma";
import { assignPartnerToOrder } from "@/lib/services/partner.service";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const include = {
  client: true,
  partner: true,
  measurements: true,
  payments: true,
  productions: true,
  documents: true,
  calculations: { orderBy: { createdAt: "desc" as const } },
  statusHistory: { orderBy: { createdAt: "desc" as const } },
  events: { orderBy: { createdAt: "desc" as const } },
} satisfies Prisma.OrderInclude;
const idOf = (value: string) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const text = (value: unknown, max = 1000) =>
  typeof value === "string" ? value.trim().slice(0, max) : null;

async function partnerScope(userId: string) {
  return prisma.partner.findUnique({
    where: { userId: Number(userId) },
    select: { id: true },
  });
}
async function canAccess(id: number, role: Role, userId: string) {
  if (role !== Role.PARTNER) return true;
  const partner = await partnerScope(userId);
  return (
    !!partner &&
    !!(await prisma.order.findFirst({
      where: { id, partnerId: partner.id },
      select: { id: true },
    }))
  );
}

function redactForRole<T extends Record<string, unknown>>(
  order: T,
  role: Role,
) {
  if (role === Role.DIRECTOR) return order;
  const result: Record<string, unknown> = { ...order };
  if (role === Role.ACCOUNTANT) {
    delete result.companyProfit;
    if (Array.isArray(result.calculations)) result.calculations = result.calculations.map((value) => {
      const calculation = { ...(value as Record<string, unknown>) };
      delete calculation.grossDifference;
      delete calculation.grossProfit;
      return calculation;
    });
    return result;
  }
  for (const field of [
    "companyProfit",
    "partnerPrice",
    "partnerPaid",
    "partnerBalance",
  ] as const)
    delete result[field];
  if (Array.isArray(result.calculations)) {
    result.calculations = result.calculations.map((value) => {
      const calculation = { ...(value as Record<string, unknown>) };
      for (const field of [
        "workshopCost",
        "baseWorkshopCost",
        "workshopRate",
        "workshopAdjustment",
        "grossDifference",
        "materialCost",
        "installationCost",
        "deliveryCost",
        "otherDirectCosts",
        "totalCost",
        "grossProfit",
      ])
        delete calculation[field];
      if (Array.isArray(calculation.lines))
        calculation.lines = calculation.lines.map((value) => {
          const line = { ...(value as Record<string, unknown>) };
          delete line.unitCost;
          delete line.totalCost;
          return line;
        });
      return calculation;
    });
  }
  if (role === Role.PARTNER) {
    delete result.amount;
    delete result.prepayment;
    delete result.balance;
    delete result.payments;
    delete result.calculations;
  }
  return result;
}

export async function GET(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const role = auth.session!.user.role as Role;
  if (!(await canAccess(id, role, auth.session!.user.id)))
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  const order = await prisma.order.findUnique({ where: { id }, include });
  return order
    ? NextResponse.json(redactForRole(order, role))
    : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
}

export async function PATCH(request: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const role = auth.session!.user.role as Role;
  if (!(await canAccess(id, role, auth.session!.user.id)))
    return NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const financial = [
      "prepayment",
      "balance",
      "partnerPaid",
      "partnerBalance",
      "companyProfit",
    ];
    if (financial.some((key) => key in body))
      return NextResponse.json(
        {
          error:
            "Расчётные финансовые поля меняются только через финансовые операции",
        },
        { status: 400 },
      );
    if (role === Role.PARTNER) {
      const allowed = new Set([
        "status",
        "partnerPlannedReadyAt",
        "partnerComment",
        "readyForInstallation",
        "installationCompleted",
        "comment",
      ]);
      if (Object.keys(body).some((key) => !allowed.has(key)))
        return NextResponse.json(
          { error: "Цеху запрещено менять эти данные заказа" },
          { status: 403 },
        );
    }
    if (body.action === "assignPartner") {
      if (role !== Role.DIRECTOR && role !== Role.MANAGER)
        return NextResponse.json(
          { error: "Недостаточно прав" },
          { status: 403 },
        );
      const partnerId = Number(body.partnerId),
        partnerPrice = Number(body.partnerPrice);
      if (
        !Number.isInteger(partnerId) ||
        partnerId <= 0 ||
        !Number.isFinite(partnerPrice) ||
        partnerPrice < 0
      )
        return NextResponse.json(
          { error: "Некорректные данные цеха" },
          { status: 400 },
        );
      const updated = await assignPartnerToOrder({
        orderId: id,
        partnerId,
        partnerPrice,
        manager: auth.session!.user.name ?? undefined,
      });
      return updated
        ? NextResponse.json(
            redactForRole(updated as unknown as Record<string, unknown>, role),
          )
        : NextResponse.json(
            { error: "Заказ или цех не найден" },
            { status: 404 },
          );
    }

    const idempotency = readIdempotencyKey(request);
    if ("response" in idempotency) return idempotency.response;
    const status =
      typeof body.status === "string"
        ? normalizeOrderStatus(body.status)
        : null;
    const comment = text(body.comment);
    const payload = {
      id,
      status,
      comment,
      partnerPlannedReadyAt: body.partnerPlannedReadyAt ?? null,
      partnerComment: body.partnerComment ?? null,
      readyForInstallation: body.readyForInstallation,
      installationCompleted: body.installationCompleted,
    };
    const requestHash = createRequestHash(payload);
    const historyKey =
      status && idempotency.key
        ? `order-status:${id}:${idempotency.key}`
        : null;
    const commentKey =
      !status && comment && idempotency.key
        ? `order-comment:${id}:${idempotency.key}`
        : null;

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.order.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!current) return null;
      if (commentKey) {
        const existing = await tx.orderEvent.findUnique({
          where: { idempotencyKey: commentKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      if (historyKey) {
        const existing = await tx.orderStatusHistory.findUnique({
          where: { idempotencyKey: historyKey },
          select: { requestHash: true },
        });
        if (existing) {
          if (existing.requestHash !== requestHash)
            throw new Error("IDEMPOTENCY_CONFLICT");
          return tx.order.findUnique({ where: { id }, include });
        }
      }
      const data: Prisma.OrderUpdateInput = {};
      if (status) {
        if (!canTransitionOrderStatus(role, current.status, status))
          throw new Error("TRANSITION_FORBIDDEN");
        data.status = status;
      } else if ("status" in body) throw new Error("INVALID_STATUS");
      if (role !== Role.PARTNER)
        for (const key of [
          "address",
          "material",
          "staircase",
          "manager",
        ] as const)
          if (typeof body[key] === "string")
            data[key] = text(body[key], 500) ?? "";
      if (role !== Role.PARTNER && "amount" in body) {
        const amount = Number(body.amount);
        if (!Number.isFinite(amount) || amount < 0)
          throw new Error("INVALID_AMOUNT");
        data.amount = amount;
      }
      if ("partnerPlannedReadyAt" in body)
        data.partnerPlannedReadyAt = body.partnerPlannedReadyAt
          ? new Date(String(body.partnerPlannedReadyAt))
          : null;
      if (typeof body.partnerComment === "string")
        data.partnerComment = text(body.partnerComment) ?? "";
      if (typeof body.readyForInstallation === "boolean")
        data.readyForInstallation = body.readyForInstallation;
      if (typeof body.installationCompleted === "boolean")
        data.installationCompleted = body.installationCompleted;
      await tx.order.update({ where: { id }, data });
      if (status) {
        await tx.orderStatusHistory.create({
          data: {
            orderId: id,
            fromStatus: normalizeOrderStatus(current.status) ?? current.status,
            toStatus: status,
            changedByUserId: Number(auth.session!.user.id) || null,
            changedByName: auth.session!.user.name ?? "Система",
            changedByRole: role,
            comment,
            idempotencyKey: historyKey,
            requestHash,
          },
        });
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Клиентский статус изменён",
            description: `${normalizeOrderStatus(current.status) ?? current.status} → ${status}${comment ? ` · ${comment}` : ""}`,
            user: auth.session!.user.name ?? "Система",
          },
        });
      } else if (role === Role.PARTNER)
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Цех обновил рабочие данные",
            description:
              text(body.partnerComment) ??
              comment ??
              "Обновлены сроки или отметки готовности",
            user: auth.session!.user.name ?? "Цех",
          },
        });
      else if (comment)
        await tx.orderEvent.create({
          data: {
            orderId: id,
            title: "Добавлен комментарий",
            description: comment,
            user: auth.session!.user.name ?? "Система",
            idempotencyKey: commentKey,
            requestHash,
          },
        });
      return tx.order.findUnique({ where: { id }, include });
    });
    return updated
      ? NextResponse.json(redactForRole(updated, role))
      : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
  } catch (error) {
    if (error instanceof Error && error.message === "IDEMPOTENCY_CONFLICT")
      return idempotencyConflict();
    if (error instanceof Error && error.message === "TRANSITION_FORBIDDEN")
      return NextResponse.json(
        { error: "Переход статуса запрещён" },
        { status: 409 },
      );
    if (
      error instanceof Error &&
      ["INVALID_STATUS", "INVALID_AMOUNT"].includes(error.message)
    )
      return NextResponse.json(
        { error: "Некорректные данные заказа" },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "Не удалось обновить заказ" },
      { status: 500 },
    );
  }
}

export async function DELETE(_: Request, { params }: Context) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  if ((auth.session!.user.role as Role) !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = idOf((await params).id);
  if (!id)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const deleted = await prisma.order
    .delete({ where: { id } })
    .catch(() => null);
  return deleted
    ? NextResponse.json(deleted)
    : NextResponse.json({ error: "Заказ не найден" }, { status: 404 });
}
