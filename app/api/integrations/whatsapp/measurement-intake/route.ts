import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import {
  createWhatsappMeasurementIntake,
  getWhatsappMeasurementIntakeReadiness,
  parseWhatsappMeasurementIntake,
} from "@/lib/integrations/whatsapp-measurement-intake";
import { runWithTenant } from "@/lib/tenant-context";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 16 * 1024;
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
    return noStoreJson(await runWithTenant(ALTYN_SAPA_TENANT, getWhatsappMeasurementIntakeReadiness));
  } catch {
    console.error("whatsapp_measurement_intake_readiness_failed");
    return noStoreJson({ error: "Integration unavailable" }, 503);
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

  let raw: unknown;
  try {
    raw = JSON.parse(rawBody) as unknown;
  } catch {
    return noStoreJson({ error: "Invalid JSON" }, 400);
  }
  const input = parseWhatsappMeasurementIntake(raw);
  if (!input) return noStoreJson({ error: "Invalid measurement intake" }, 400);
  const dryRun = Boolean(raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Record<string, unknown>).dryRun === true);

  try {
    if (dryRun) {
      const readiness = await runWithTenant(ALTYN_SAPA_TENANT, getWhatsappMeasurementIntakeReadiness);
      return readiness.ready
        ? noStoreJson({ accepted: true, dryRun: true })
        : noStoreJson({ error: "Dispatcher unavailable" }, 503);
    }
    const result = await runWithTenant(ALTYN_SAPA_TENANT, () => createWhatsappMeasurementIntake(input));
    return noStoreJson(result, result.duplicate ? 200 : 201);
  } catch (error) {
    if (error instanceof Error && error.message === "WHATSAPP_MEASUREMENT_DISPATCHER_UNAVAILABLE") {
      return noStoreJson({ error: "Dispatcher unavailable" }, 503);
    }
    console.error("whatsapp_measurement_intake_failed");
    return noStoreJson({ error: "Integration unavailable" }, 503);
  }
}
