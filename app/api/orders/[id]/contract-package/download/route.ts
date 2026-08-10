import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requireOrder360Actor } from "@/lib/order360-auth";
import { downloadContractPackage } from "@/lib/services/contract-package.service";
import type { DocumentActor } from "@/lib/services/document.service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrder360Actor();
  if (auth.response) return auth.response;
  if (auth.actor!.role !== Role.DIRECTOR && auth.actor!.role !== Role.MANAGER)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const bytes = await downloadContractPackage(id, auth.actor as DocumentActor);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`Договорный-комплект-${id}.zip`)}`,
        "Content-Length": String(bytes.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "DOWNLOAD_FAILED";
    return NextResponse.json({ error: code }, { status: code === "NOT_FOUND" ? 404 : 500 });
  }
}
