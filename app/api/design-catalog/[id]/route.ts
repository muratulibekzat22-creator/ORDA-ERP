import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import { getDesignCatalogContent } from "@/lib/services/design-catalog.service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  const result = await getDesignCatalogContent(id);
  if (!result)
    return NextResponse.json({ error: "Работа не найдена" }, { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const encodedName = encodeURIComponent(result.attachment.fileName);
  return new Response(result.blob.stream, {
    headers: {
      "Content-Type": result.attachment.contentType,
      "Content-Length": String(result.attachment.size),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
