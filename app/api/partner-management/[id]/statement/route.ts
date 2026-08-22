import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { partnerStatementCsv, partnerStatementPdf } from "@/lib/partners/statement";
import { requirePermission } from "@/lib/server-auth";
import { getManagedPartner, PartnerManagementError } from "@/lib/services/partner-management.service";
import { enterTenantFromSession } from "@/lib/tenant-context";

type Context = { params: Promise<{ id: string }> };
const parsedDate = (value: string | null) => {
  if (!value) return undefined;
  const date = new Date(value); return Number.isNaN(date.getTime()) ? undefined : date;
};

export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("partners");
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!enterTenantFromSession(auth.session)) return NextResponse.json({ error: "Сессия завершена" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const url = new URL(request.url);
    const format = url.searchParams.get("format") ?? "json";
    const from = parsedDate(url.searchParams.get("from"));
    const to = parsedDate(url.searchParams.get("to"));
    const statement = await getManagedPartner(id);
    if (format === "csv") return new Response(partnerStatementCsv(statement, from, to), { headers: {
      "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="partner-${id}-statement.csv"`, "cache-control": "no-store",
    } });
    if (format === "pdf") return new Response(new Uint8Array(await partnerStatementPdf(statement, from, to)), { headers: {
      "content-type": "application/pdf", "content-disposition": `attachment; filename="partner-${id}-statement.pdf"`, "cache-control": "private, no-store",
    } });
    return NextResponse.json(statement, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof PartnerManagementError && error.message === "PARTNER_NOT_FOUND")
      return NextResponse.json({ error: "Партнёр не найден" }, { status: 404 });
    return NextResponse.json({ error: "Не удалось сформировать выписку" }, { status: 500 });
  }
}
