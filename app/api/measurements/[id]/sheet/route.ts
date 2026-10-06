import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { buildMeasurementSheetPdf } from "@/lib/services/measurement-sheet-pdf.service";
import { getGeneratedMeasurementSheetData, type DocumentActor } from "@/lib/services/document.service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный замер" }, { status: 400 });
  const actor: DocumentActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? "" };
  const measurement = await getGeneratedMeasurementSheetData(id, actor); if (!measurement) return NextResponse.json({ error: "Замерный лист не найден" }, { status: 404 });
  const redactCommercial = actor.role === Role.PARTNER || actor.role === Role.PRODUCTION || actor.role === Role.INSTALLER || actor.role === Role.DESIGNER;
  const url = new URL(request.url);
  const language = url.searchParams.get("lang") === "uz" ? "uz" : "ru";
  const pdf = await buildMeasurementSheetPdf({ ...(measurement as unknown as Record<string, unknown>), redactCommercial, language });
  const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(new Uint8Array(pdf), { headers: { "Content-Type": "application/pdf", "Content-Length": String(pdf.byteLength), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(`zamer-${id}.pdf`)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
