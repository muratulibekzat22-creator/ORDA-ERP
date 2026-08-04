import { NextResponse } from "next/server";

import { getFinanceDashboard } from "@/lib/services/payment.service";
import { requirePermission } from "@/lib/server-auth";

export async function GET(request: Request) {
  const auth=await requirePermission("finance");if(auth.response)return auth.response;
  if(auth.session!.user.role==="PARTNER")return NextResponse.json({error:"Недостаточно прав"},{status:403});
  try {
    const { searchParams } = new URL(request.url);
    const partnerId = Number(searchParams.get("partnerId"));

    const data = await getFinanceDashboard({
      period: (searchParams.get("period") ?? "all") as "all" | "month" | "quarter" | "year",
      manager: searchParams.get("manager") || undefined,
      partnerId: Number.isInteger(partnerId) && partnerId > 0 ? partnerId : undefined,
      paymentStatus: (searchParams.get("paymentStatus") ?? "all") as "all" | "debt" | "partial" | "paid",
    });

    return NextResponse.json(data);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Ошибка загрузки финансов" }, { status: 500 });
  }
}
