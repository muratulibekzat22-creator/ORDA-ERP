import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  getWhatsappPartnerReadiness,
  lookupWhatsappOrderStatus,
  type WhatsappOrderLookup,
} from "@/lib/integrations/whatsapp-order-status";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4 * 1024;
const ALTYN_SAPA_TENANT = {
  companyId: 1,
  companySlug: "altyn-sapa-company",
  companyName: "ALTYN SAPA",
  isDemo: false,
} as const;

function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      Pragma: "no-cache",
      Vary: "Authorization",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function authorized(request: Request) {
  const expectedToken = process.env.WHATSAPP_ORDER_STATUS_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  if (!expectedToken || !supplied.startsWith(prefix)) return false;
  const expectedHash = createHash("sha256").update(expectedToken).digest();
  const suppliedHash = createHash("sha256").update(supplied.slice(prefix.length)).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

export async function GET(request: Request) {
  if (!authorized(request)) return noStoreJson({ error: "Not found" }, 404);
  try {
    const partners = await runWithTenant(ALTYN_SAPA_TENANT, getWhatsappPartnerReadiness);
    return noStoreJson({ ready: partners.every((partner) => partner.found && partner.active && !partner.archived && partner.businessStatus === "ACTIVE"), partners });
  } catch {
    console.error("whatsapp_partner_readiness_failed");
    return noStoreJson({ error: "Lookup unavailable" }, 503);
  }
}

export async function POST(request: Request) {
  if (!authorized(request)) return noStoreJson({ error: "Not found" }, 404);
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return noStoreJson({ error: "Payload too large" }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return noStoreJson({ error: "Payload too large" }, 413);
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    body = parsed as Record<string, unknown>;
  } catch {
    return noStoreJson({ error: "Invalid JSON" }, 400);
  }

  const lookupType = body.lookupType;
  const value = body.value;
  if ((lookupType !== "phone" && lookupType !== "contract") || typeof value !== "string") {
    return noStoreJson({ error: "Invalid lookup" }, 400);
  }

  try {
    const result = await runWithTenant(ALTYN_SAPA_TENANT, () =>
      lookupWhatsappOrderStatus({ lookupType, value } as WhatsappOrderLookup),
    );
    return noStoreJson(result);
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_LOOKUP") {
      return noStoreJson({ error: "Invalid lookup" }, 400);
    }
    console.error("whatsapp_order_status_lookup_failed");
    return noStoreJson({ error: "Lookup unavailable" }, 503);
  }
}
