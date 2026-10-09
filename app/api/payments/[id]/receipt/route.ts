import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { ensurePaymentReceiptForExistingPayment } from "@/lib/services/payment-receipt.service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("documents");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const receipt = await ensurePaymentReceiptForExistingPayment(id, {
      userId: Number(auth.session!.user.id),
      role: auth.session!.user.role as Role,
      name: auth.session!.user.name ?? "",
    });
    return NextResponse.json({ receipt });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "FORBIDDEN") return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    if (code === "NOT_FOUND") return NextResponse.json({ error: "Платёж не найден" }, { status: 404 });
    return NextResponse.json({ error: "Не удалось сформировать квитанцию" }, { status: 500 });
  }
}
