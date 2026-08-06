import crypto from "crypto";
import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const hash = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function POST(_: Request, { params }: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.MANAGER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const approval = await tx.priceApprovalRequest.findUnique({ where: { id }, include: { calculation: { include: { client: true } } } });
      if (!approval || approval.managerUserId !== Number(auth.session!.user.id) || !["APPROVED", "COUNTER_OFFER"].includes(approval.status) || !approval.approvedSalePrice) throw new Error("INVALID_APPROVAL");
      if (approval.snapshotHash !== hash(approval.calculation.snapshot)) throw new Error("SNAPSHOT_CHANGED");
      const already = await tx.leadCalculation.findFirst({ where: { clientId: approval.clientId, comment: `approval:${approval.id}` } });
      if (already) throw new Error("APPROVAL_ALREADY_USED");
      const created = await tx.leadCalculation.create({ data: {
        clientId: approval.clientId,
        material: approval.calculation.material,
        baseClientPrice: approval.calculation.baseClientPrice,
        clientPrice: approval.approvedSalePrice,
        internalCost: approval.calculation.internalCost,
        snapshot: JSON.parse(JSON.stringify(approval.calculation.snapshot)),
        comment: `approval:${approval.id}`,
        authorId: Number(auth.session!.user.id),
        authorName: auth.session!.user.name ?? approval.managerName,
        adjustments: { create: { originalPrice: approval.calculation.clientPrice, newPrice: approval.approvedSalePrice, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? approval.managerName, comment: `Согласование №${approval.id}` } },
      } });
      await tx.leadActivity.create({ data: { clientId: approval.clientId, type: "APPROVED_PRICE_APPLIED", comment: `Применена согласованная цена, согласование №${approval.id}`, authorId: Number(auth.session!.user.id), authorName: auth.session!.user.name ?? approval.managerName } });
      return created;
    });
    const safe = { ...result } as Record<string, unknown>;
    delete safe.internalCost;
    delete safe.snapshot;
    return NextResponse.json(safe, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Согласование недействительно или уже не соответствует расчёту" }, { status: 409 });
  }
}
