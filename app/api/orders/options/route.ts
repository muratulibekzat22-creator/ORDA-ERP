import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { MATERIAL_CODES } from "@/lib/calculator/tariffs";
import { normalizePhone } from "@/lib/leads/domain";
import { FRAME_TYPES, PAYMENT_METHODS, RAILING_TYPES } from "@/lib/orders/registration";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

export async function GET(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });

  const userId = Number(auth.session!.user.id);
  const phone = normalizePhone(new URL(request.url).searchParams.get("phone") ?? "");
  const [managers, existing, configuredMaterials] = await Promise.all([
    prisma.user.findMany({
      where: role === Role.MANAGER
        ? { id: userId, active: true, role: Role.MANAGER }
        : { active: true, role: Role.MANAGER },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    phone ? prisma.client.findFirst({
      where: { active: true, OR: [{ phone }, { whatsapp: phone }] },
      select: { id: true, name: true, phone: true, city: true, address: true, managerUserId: true, manager: true },
    }) : null,
    prisma.calculatorTariff.findMany({
      where: { active: true, kind: "STAIR_MATERIAL" },
      select: { uiName: true },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
  ]);
  const ownershipConflict = Boolean(existing && role === Role.MANAGER && existing.managerUserId !== userId && existing.manager !== auth.session!.user.name);
  return NextResponse.json({
    role,
    currentUserId: userId,
    managers,
    materials: [...new Set([
      ...(configuredMaterials.length ? configuredMaterials.map((item) => item.uiName) : Object.keys(MATERIAL_CODES)),
      "Другое",
    ])],
    frameTypes: FRAME_TYPES,
    railingTypes: RAILING_TYPES,
    paymentMethods: PAYMENT_METHODS,
    existingClient: existing && !ownershipConflict ? existing : null,
    ownershipConflict,
  });
}
