import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireTrainingRole } from "@/lib/training-api";
import { trainingReport } from "@/lib/services/training.service";

export async function GET() {
  const auth = await requireTrainingRole(Role.DIRECTOR);
  if (auth.response) return auth.response;
  return NextResponse.json(await trainingReport(), {
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
