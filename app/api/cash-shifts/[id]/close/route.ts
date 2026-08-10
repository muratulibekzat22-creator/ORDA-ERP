import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import type { DocumentActor } from "@/lib/services/document.service";
import { closeCashShift } from "@/lib/services/payment-receipt.service";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("finance");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    return NextResponse.json(await closeCashShift(id, {
      userId: Number(auth.session!.user.id),
      role: auth.session!.user.role as Role,
      name: auth.session!.user.name ?? "",
    } satisfies DocumentActor));
  } catch (error) {
    const code = error instanceof Error ? error.message : "SHIFT_CLOSE_FAILED";
    return NextResponse.json({ error: code }, { status: code === "FORBIDDEN" ? 403 : code === "NOT_FOUND" ? 404 : 500 });
  }
}
