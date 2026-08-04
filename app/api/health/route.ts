import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL;
  let databaseHost: string | null = null;

  if (databaseUrl) {
    try {
      databaseHost = new URL(databaseUrl).hostname;
    } catch {
      databaseHost = null;
    }
  }

  const diagnostics = {
    envPresent: Boolean(databaseUrl),
    databaseHost,
    environment: process.env.VERCEL_ENV ?? "unknown",
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", database: "ok", ...diagnostics });
  } catch {
    return NextResponse.json({ status: "unavailable", database: "unavailable", ...diagnostics }, { status: 503 });
  }
}
