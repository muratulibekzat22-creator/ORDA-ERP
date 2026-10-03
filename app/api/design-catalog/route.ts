import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { listDesignCatalogItems } from "@/lib/services/design-catalog.service";

export async function GET() {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  return NextResponse.json(await listDesignCatalogItems());
}
