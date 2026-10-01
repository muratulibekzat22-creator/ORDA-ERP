import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { cancelPaymentFollowUp } from "@/lib/services/payment-follow-up.service";

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; taskId: string }> }) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const values = await params;
  const orderId = Number(values.id);
  const taskId = Number(values.taskId);
  if (![orderId, taskId].every((value) => Number.isInteger(value) && value > 0))
    return NextResponse.json({ error: "Некорректное напоминание" }, { status: 400 });
  try {
    return NextResponse.json(await cancelPaymentFollowUp({
      orderId,
      taskId,
      actor: {
        userId: Number(auth.session!.user.id),
        name: auth.session!.user.name ?? "Пользователь",
        role: (auth.session!.user.accountRole || auth.session!.user.role) as Role,
      },
    }));
  } catch (error) {
    if (error instanceof Error && error.message === "PAYMENT_FOLLOW_UP_NOT_FOUND")
      return NextResponse.json({ error: "Напоминание не найдено" }, { status: 404 });
    if (error instanceof Error && error.message === "PAYMENT_FOLLOW_UP_TERMINAL")
      return NextResponse.json({ error: "Завершённое напоминание нельзя отменить" }, { status: 409 });
    throw error;
  }
}
