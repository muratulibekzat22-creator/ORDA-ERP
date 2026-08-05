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
  if (!Object.values(Role).includes(role) || !await hasPermission(role, "orders")) return null;
  if ((role as unknown as PrismaRole) === PrismaRole.PARTNER) {
    const partner = await prisma.partner.findUnique({ where: { userId: Number(session.user.id) }, select: { id: true } });
    if (!partner || !await prisma.order.findFirst({ where: { id, partnerId: partner.id }, select: { id: true } })) return null;
  }
  return getOrder(id);
}
