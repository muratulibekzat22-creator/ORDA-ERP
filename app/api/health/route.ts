import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { productionLog } from "@/lib/observability";

export async function GET(request: Request) {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    productionLog("error", "database.unavailable", { requestId: request.headers.get("x-request-id") ?? undefined, route: "/api/health", method: "GET", error });
    return NextResponse.json({ status: "unavailable", database: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
