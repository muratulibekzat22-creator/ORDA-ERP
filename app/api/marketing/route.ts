import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { createRequestHash, readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  convertInquiryToApplication,
  createCampaignLevel,
  createMarketingCampaign,
  createMarketingCatalog,
  createMarketingInquiry,
  createMarketingSpend,
  getMarketingWorkspace,
  importMarketingMetrics,
  marketingErrorResponse,
  reviewMarketingSpend,
  saveMarketingBudget,
  updateInquiry,
  updatePrimaryAttribution,
  type MarketingActor,
} from "@/lib/services/marketing.service";

function actorFrom(session: { user: { id: string; name?: string | null; role: string } }): MarketingActor {
  return { userId: Number(session.user.id), name: session.user.name ?? "ORDA", role: session.user.role as Role };
}

function parseRange(request: Request) {
  const params = new URL(request.url).searchParams;
  const now = new Date();
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 29));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const from = params.get("from") ? new Date(params.get("from")!) : defaultFrom;
  const toInput = params.get("to") ? new Date(params.get("to")!) : defaultTo;
  const to = params.get("to") ? new Date(toInput.getTime() + 86_400_000) : toInput;
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from >= to || to.getTime() - from.getTime() > 732 * 86_400_000) return null;
  return { from, to, search: params.get("search") ?? undefined };
}

export async function GET(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.OPERATIONS_DIRECTOR && role !== Role.MARKETER) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const filters = parseRange(request);
  if (!filters) return NextResponse.json({ error: "Некорректный период" }, { status: 400 });
  try {
    return NextResponse.json(await getMarketingWorkspace(actorFrom(auth.session!), filters));
  } catch (error) {
    const known = marketingErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    throw error;
  }
}

export async function POST(request: Request) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  try {
    const body = await request.json() as Record<string, unknown>;
    const command = typeof body.command === "string" ? body.command : "";
    const role = auth.session!.user.role as Role;
    if (role !== Role.DIRECTOR && role !== Role.MARKETER && !(role === Role.ACCOUNTANT && command === "reviewSpend")) return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
    const actor = actorFrom(auth.session!);
    if (command === "createCatalog") return NextResponse.json(await createMarketingCatalog(body, actor), { status: 201 });
    if (command === "createCampaign") return NextResponse.json(await createMarketingCampaign(body, actor), { status: 201 });
    if (command === "createCampaignLevel") return NextResponse.json(await createCampaignLevel(body, actor), { status: 201 });
    if (command === "createInquiry") return NextResponse.json(await createMarketingInquiry(body, actor), { status: 201 });
    if (command === "convertInquiry") return NextResponse.json(await convertInquiryToApplication(Number(body.inquiryId), body, actor), { status: 201 });
    if (command === "updateInquiry") return NextResponse.json(await updateInquiry(Number(body.inquiryId), body, actor));
    if (command === "updateAttribution") return NextResponse.json(await updatePrimaryAttribution(Number(body.applicationId), body, actor));
    if (command === "saveBudget") return NextResponse.json(await saveMarketingBudget(body, actor), { status: 201 });

    if (["importMetrics", "createMetric", "createSpend", "reviewSpend"].includes(command)) {
      const key = readIdempotencyKey(request); if ("response" in key) return key.response;
      const requestHash = createRequestHash(body);
      if (command === "importMetrics") return NextResponse.json(await importMarketingMetrics(Array.isArray(body.rows) ? body.rows as Record<string, unknown>[] : [], key.key, actor));
      if (command === "createMetric") return NextResponse.json(await importMarketingMetrics([body], key.key, actor, "MANUAL"), { status: 201 });
      if (command === "createSpend") {
        const result = await createMarketingSpend(body, key.key, requestHash, actor);
        return NextResponse.json(result, { status: result.created ? 201 : 200 });
      }
      return NextResponse.json(await reviewMarketingSpend(Number(body.spendId), body, key.key, requestHash, actor));
    }
    return NextResponse.json({ error: "Неизвестная команда" }, { status: 400 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    const known = marketingErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    throw error;
  }
}
