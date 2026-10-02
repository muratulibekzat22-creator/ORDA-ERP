import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { metaAdsIntegrationStatus, syncMetaAdsMonth } from "@/lib/integrations/meta-ads";
import { ensureDailyManagerOperations } from "@/lib/services/daily-operations.service";
import { reconcileCurrentManagerPayroll } from "@/lib/services/payroll.service";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Schedule is not configured" }, { status: 503 });
  const actual = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = process.env.FOUNDER_CONTROL_COMPANY_SLUG;
  if (!slug) return NextResponse.json({ error: "Company is not configured" }, { status: 503 });
  const company = await runWithSystemAccess(() => prisma.company.findUnique({
    where: { slug },
    select: { id: true, slug: true, name: true, active: true, isDemo: true },
  }));
  if (!company?.active || company.isDemo) return NextResponse.json({ error: "Company unavailable" }, { status: 503 });
  return runWithTenant({ companyId: company.id, companySlug: company.slug, companyName: company.name, isDemo: false }, async () => {
    const directors = await prisma.user.findMany({ where: { active: true, role: "OPERATIONS_DIRECTOR" }, select: { id: true } });
    if (directors.length !== 1) return NextResponse.json({ error: "A unique operations director is required" }, { status: 409 });
    const director = await prisma.user.findUniqueOrThrow({ where: { id: directors[0].id }, select: { id: true, name: true, role: true } });
    const result = await ensureDailyManagerOperations(director.id);
    const payroll = await reconcileCurrentManagerPayroll({ userId: director.id, name: director.name, role: director.role });
    const meta = metaAdsIntegrationStatus().configured
      ? await syncMetaAdsMonth({ actorId: director.id }).catch((error: unknown) => ({ error: error instanceof Error ? error.message : "META_SYNC_FAILED" }))
      : { skipped: "META_NOT_CONFIGURED" };
    return NextResponse.json({ result, payroll, meta }, { headers: { "Cache-Control": "no-store" } });
  });
}
