import { NextResponse } from "next/server";

import { requireOrder360Actor } from "@/lib/order360-auth";
import { getSignedContractContent, type ContractActor } from "@/lib/services/contract.service";
import { uploadSignedPackageDocument } from "@/lib/services/contract-package.service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrder360Actor(); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  const result = await getSignedContractContent(id, auth.actor as ContractActor);
  if (!result) return NextResponse.json({ error: "Подписанная копия не найдена" }, { status: 404 });
  return new NextResponse(result.blob.stream, { headers: { "Content-Type": result.document.signedContentType!, "Content-Length": String(result.document.signedSize), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(result.document.signedFileName!)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOrder360Actor(); if (auth.response) return auth.response;
  const id = Number((await params).id); if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Некорректный id" }, { status: 400 });
  try {
    const form = await request.formData(), file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Выберите PDF, JPEG или PNG" }, { status: 400 });
    return NextResponse.json(await uploadSignedPackageDocument(id, auth.actor as ContractActor, file, String(form.get("comment") ?? "")));
  } catch (error) {
    const code = error instanceof Error ? error.message : "UPLOAD_FAILED";
    const label = code === "INVALID_FILE_TYPE" ? "Файл не соответствует PDF/JPEG/PNG или превышает 15 МБ" : code === "MEMO_ACKNOWLEDGEMENT_REQUIRED" ? "Сначала подтвердите, что памятка передана клиенту и разъяснена" : code;
    return NextResponse.json({ error: label }, { status: code === "NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : code === "INVALID_FILE_TYPE" || code === "MEMO_ACKNOWLEDGEMENT_REQUIRED" ? 400 : 500 });
  }
}
