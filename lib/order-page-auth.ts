import { Role as PrismaRole } from "@prisma/client";
import { getServerSession } from "next-auth";

import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { prisma } from "@/lib/prisma";
import { Role } from "@/lib/roles";
import { hasPermission } from "@/lib/services/permission.service";
import { getOrder } from "@/lib/services/order.service";

export async function getAuthorizedOrder(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const session = await getServerSession(authOptions);
  if (!session?.user) return null;
  const role = session.user.role as Role;
  if (
    !Object.values(Role).includes(role) ||
    !(await hasPermission(role, "orders"))
  )
    return null;
  if ((role as unknown as PrismaRole) === PrismaRole.PARTNER) {
    const partner = await prisma.partner.findUnique({
      where: { userId: Number(session.user.id) },
      select: { id: true },
    });
    if (
      !partner ||
      !(await prisma.order.findFirst({
        where: { id, partnerId: partner.id },
        select: { id: true },
      }))
    )
      return null;
  }
  const order = await getOrder(id);
  if (!order || role === Role.DIRECTOR) return order;
  if (role === Role.ACCOUNTANT) return {
    ...order,
    companyProfit: undefined,
    calculations: order.calculations.map((calculation) => {
      const result = { ...calculation } as Partial<typeof calculation>;
      delete result.grossDifference;
      delete result.grossProfit;
      return result;
    }),
  } as unknown as typeof order;

  if (role === Role.PARTNER) return {
    ...order,
    amount: undefined,
    prepayment: undefined,
    balance: undefined,
    companyProfit: undefined,
    payments: [],
    calculations: [],
  } as unknown as typeof order;

  // Server Components serialize their props into the RSC response. Remove
  // management figures here as well as in the REST API so they never reach a
  // manager's browser, even when the interface does not render them.
  return {
    ...order,
    partnerPrice: undefined,
    companyProfit: undefined,
    partnerPaid: undefined,
    partnerBalance: undefined,
    calculations: order.calculations.map((calculation) => ({
      id: calculation.id,
      orderId: calculation.orderId,
      material: calculation.material,
      regularSteps: calculation.regularSteps,
      platformEquivalents: calculation.platformEquivalents,
      equivalentSteps: calculation.equivalentSteps,
      saleRate: calculation.saleRate,
      baseClientPrice: calculation.baseClientPrice,
      clientPrice: calculation.clientPrice,
      clientAdjustment: calculation.clientAdjustment,
      installationRequired: calculation.installationRequired,
      deliveryRequired: calculation.deliveryRequired,
      otherCity: calculation.otherCity,
      pickup: calculation.pickup,
      createdByUserId: calculation.createdByUserId,
      createdByName: calculation.createdByName,
      idempotencyKey: calculation.idempotencyKey,
      requestHash: calculation.requestHash,
      createdAt: calculation.createdAt,
      lines: calculation.lines.map((line) => ({
        id: line.id,
        calculationId: line.calculationId,
        kind: line.kind,
        name: line.name,
        quantity: line.quantity,
        unit: line.unit,
        unitSale: line.unitSale,
        totalSale: line.totalSale,
        comment: line.comment,
        enabled: line.enabled,
        position: line.position,
      })),
    })),
  } as unknown as typeof order;
}
