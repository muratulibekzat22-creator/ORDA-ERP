import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { getDocumentOptions, type DocumentActor } from "@/lib/services/document.service";

export async function GET() {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const actor: DocumentActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? "" };
  return NextResponse.json(await getDocumentOptions(actor));
}
