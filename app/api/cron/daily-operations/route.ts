import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { ensureDailyManagerOperations } from "@/lib/services/daily-operations.service";
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
    const founders = await prisma.user.findMany({ where: { active: true, role: "DIRECTOR" }, select: { id: true } });
    if (founders.length !== 1) return NextResponse.json({ error: "A unique founder is required" }, { status: 409 });
    const result = await ensureDailyManagerOperations(founders[0].id);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "no-store" } });
  });
}
