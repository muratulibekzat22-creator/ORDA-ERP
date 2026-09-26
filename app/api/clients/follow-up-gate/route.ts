import { LeadStage, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { PROPOSAL_FOLLOW_UP_COPY } from "@/lib/leads/proposal-follow-up";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { requireTenantIdentity } from "@/lib/tenant-context";

export async function GET() {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.MANAGER)
    return NextResponse.json({ blocked: false, items: [] });

  const now = new Date();
  const companyId = requireTenantIdentity().companyId;
  const items = await prisma.leadNextAction.findMany({
    where: {
      mandatory: true,
      completedAt: null,
      nextActionAt: { lte: now },
      client: {
        companyId,
        managerUserId: Number(auth.session!.user.id),
        active: true,
        deletedAt: null,
        stage: { notIn: [LeadStage.WON, LeadStage.LOST] },
      },
    },
    select: {
      id: true,
      clientId: true,
      nextActionAt: true,
      followUpStep: true,
      nextActionComment: true,
      client: { select: { name: true, phone: true, whatsapp: true } },
      proposal: { select: { id: true, number: true } },
    },
    orderBy: [{ nextActionAt: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({
    blocked: items.length > 0,
    generatedAt: now,
    items: items.map((item) => ({
      ...item,
      message:
        item.followUpStep === 2
          ? PROPOSAL_FOLLOW_UP_COPY[2]
          : PROPOSAL_FOLLOW_UP_COPY[1],
    })),
  });
}
