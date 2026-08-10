import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";
import { getDocument, type DocumentActor } from "@/lib/services/document.service";
import { ensurePaymentReceiptPdf } from "@/lib/services/payment-receipt.service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const actor: DocumentActor = {
    userId: Number(auth.session!.user.id),
    role: auth.session!.user.role as Role,
    name: auth.session!.user.name ?? "",
  };
  const receipt = await prisma.paymentReceipt.findUnique({ where: { id } });
  if (!receipt || !await getDocument(receipt.documentId, actor))
    return NextResponse.json({ error: "Квитанция не найдена" }, { status: 404 });
  try {
    const version = await ensurePaymentReceiptPdf(receipt.paymentId);
    return NextResponse.json({ version });
  } catch {
    return NextResponse.json({ error: "Не удалось сформировать PDF квитанции" }, { status: 503 });
  }
}
