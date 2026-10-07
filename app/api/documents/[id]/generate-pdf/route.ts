import { DocumentType, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getDocument, type DocumentActor } from "@/lib/services/document.service";
import { ensurePaymentReceiptPdf } from "@/lib/services/payment-receipt.service";
import { ensureRefundConfirmationPdf } from "@/lib/services/refund.service";
import { ensureWarehouseShipmentPdf } from "@/lib/services/warehouse-document.service";
import { prisma } from "@/lib/prisma";

export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный документ" }, { status: 400 });
  const actor: DocumentActor = {
    userId: Number(auth.session!.user.id),
    role: auth.session!.user.role as Role,
    name: auth.session!.user.name ?? "",
  };
  const document = await getDocument(id, actor);
  if (!document)
    return NextResponse.json({ error: "Документ не найден" }, { status: 404 });
  try {
    if (document.type === DocumentType.PAYMENT_RECEIPT && document.paymentId) {
      const version = await ensurePaymentReceiptPdf(document.paymentId);
      return NextResponse.json({ version });
    }
    if (document.type === DocumentType.OUTGOING_INVOICE) {
      const shipment = await prisma.warehouseShipment.findUnique({
        where: { documentId: document.id },
        select: { id: true },
      });
      if (!shipment)
        return NextResponse.json({ error: "Отгрузка не найдена" }, { status: 404 });
      const version = await ensureWarehouseShipmentPdf(shipment.id);
      return NextResponse.json({ version });
    }
    if (document.type === DocumentType.REFUND_CONFIRMATION) {
      const version = await ensureRefundConfirmationPdf(document.id);
      return NextResponse.json({ version });
    }
    return NextResponse.json(
      { error: "Для этого документа автоматический PDF не предусмотрен" },
      { status: 400 },
    );
  } catch {
    return NextResponse.json(
      { error: "Не удалось сформировать PDF. Учётная операция не повторялась." },
      { status: 503 },
    );
  }
}
