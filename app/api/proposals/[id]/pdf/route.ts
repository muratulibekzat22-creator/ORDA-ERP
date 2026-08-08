import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { buildProposalPdf } from "@/lib/services/proposal-pdf.service";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const id = Number((await params).id),
    role = auth.session!.user.role as Role;
  if (!Number.isInteger(id) || (role !== Role.DIRECTOR && role !== Role.MANAGER))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const proposal = await prisma.commercialProposal.findFirst({
    where: {
      id,
      ...(role === Role.MANAGER
        ? { client: { managerUserId: Number(auth.session!.user.id) } }
        : {}),
    },
    select: { number: true, snapshot: true },
  });
  if (!proposal)
    return NextResponse.json({ error: "КП не найдено" }, { status: 404 });
  const pdf = await buildProposalPdf(proposal.snapshot);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="proposal-${proposal.number}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
