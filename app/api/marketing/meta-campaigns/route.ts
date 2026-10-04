import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { loadMetaAdsCampaignReport, MetaAdsSyncError } from "@/lib/integrations/meta-ads";
import { requirePermission } from "@/lib/server-auth";

export async function GET(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = (auth.session!.user.accountRole || auth.session!.user.role) as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR && role !== Role.MARKETER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const month = new URL(request.url).searchParams.get("month") ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    return NextResponse.json({ error: "Некорректный месяц" }, { status: 400 });
  try {
    return NextResponse.json(await loadMetaAdsCampaignReport(month), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code = error instanceof MetaAdsSyncError ? error.message : "META_REPORT_FAILED";
    return NextResponse.json(
      { error: code === "META_NOT_CONFIGURED" ? "Нужно подключить доступ Meta и указать кампании" : "Не удалось загрузить кампании Meta" },
      { status: code === "META_NOT_CONFIGURED" ? 503 : 502 },
    );
  }
}
