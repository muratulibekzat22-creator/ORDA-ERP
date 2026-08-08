import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/server-auth";
import { getLinkedMeasurementContent, type DocumentActor } from "@/lib/services/document.service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("documents"); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const actor: DocumentActor = { userId: Number(auth.session!.user.id), role: auth.session!.user.role as Role, name: auth.session!.user.name ?? "" };
  const result = await getLinkedMeasurementContent(id, actor);
  if (!result) return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
  const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
  return new NextResponse(result.blob.stream, { headers: { "Content-Type": result.file.contentType, "Content-Length": String(result.file.size), "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(result.file.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
