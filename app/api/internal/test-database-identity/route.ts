import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const expectedToken = process.env.TEST_DATABASE_PROBE_TOKEN;
  const suppliedToken = request.headers.get("x-test-database-probe-token") ?? "";
  if (!expectedToken) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const expected = createHash("sha256").update(expectedToken).digest();
  const supplied = createHash("sha256").update(suppliedToken).digest();
  if (!timingSafeEqual(expected, supplied)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  return NextResponse.json(
    { fingerprint: createHash("sha256").update(databaseUrl).digest("hex") },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
