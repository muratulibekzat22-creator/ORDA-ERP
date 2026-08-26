import { Role } from "@prisma/client";
import { NextResponse } from "next/server";

import { readIdempotencyKey } from "@/lib/idempotency";
import { requirePermission } from "@/lib/server-auth";
import {
  MarketingContentError,
  MAX_MARKETING_ASSET_SIZE,
  uploadMarketingContentAsset,
  type MarketingContentActor,
} from "@/lib/services/marketing-content.service";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const auth = await requirePermission("marketing");
  if (auth.response) return auth.response;
  const taskId = Number((await params).id);
  if (!Number.isInteger(taskId) || taskId <= 0)
    return NextResponse.json({ error: "Некорректная задача" }, { status: 400 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size <= 0 || file.size > MAX_MARKETING_ASSET_SIZE)
      return NextResponse.json(
        { error: "Разрешены JPG, PNG, WEBP, MP4 и WEBM до 20 МБ" },
        { status: 400 },
      );
    const actor: MarketingContentActor = {
      userId: Number(auth.session!.user.id),
      name: auth.session!.user.name ?? "ORDA",
      role: auth.session!.user.role as Role,
    };
    const result = await uploadMarketingContentAsset({
      taskId,
      file,
      idempotencyKey: idempotency.key,
      actor,
    });
    return NextResponse.json(result.asset, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof MarketingContentError) {
      const status = error.message === "NOT_FOUND" ? 404 : error.message === "FORBIDDEN" ? 403 : error.message === "IDEMPOTENCY_CONFLICT" ? 409 : 400;
      return NextResponse.json(
        { error: error.message === "INVALID_FILE" ? "Содержимое файла не соответствует формату" : "Файл не загружен" },
        { status },
      );
    }
    return NextResponse.json({ error: "Файл не загружен" }, { status: 500 });
  }
}
