import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { requirePermission } from "@/lib/server-auth";
import {
  getMarketingContentAsset,
  type MarketingContentActor,
} from "@/lib/services/marketing-content.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0)
    return NextResponse.json({ error: "Некорректный файл" }, { status: 400 });
  try {
    const actor: MarketingContentActor = {
      userId: Number(auth.session!.user.id),
      name: auth.session!.user.name ?? "ORDA",
      role: auth.session!.user.role as Role,
    };
    const result = await getMarketingContentAsset(id, actor);
    if (!result)
      return NextResponse.json({ error: "Файл не найден" }, { status: 404 });
    const disposition = new URL(request.url).searchParams.get("download") === "1" ? "attachment" : "inline";
    const encodedName = encodeURIComponent(result.asset.fileName).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(result.blob.stream, {
      headers: {
        "Content-Type": result.asset.contentType,
        "Content-Length": String(result.asset.size),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Не удалось открыть файл" }, { status: 500 });
  }
}
