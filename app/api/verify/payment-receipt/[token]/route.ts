import { NextResponse } from "next/server";

import { paymentReceiptPublicProjection } from "@/lib/services/payment-receipt.service";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const result = await paymentReceiptPublicProjection((await params).token);
  return result
    ? NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=60, must-revalidate" } })
    : NextResponse.json({ error: "Квитанция не найдена" }, { status: 404 });
}
