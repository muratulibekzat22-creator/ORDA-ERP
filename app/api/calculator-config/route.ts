import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCalculatorTariffs } from "@/lib/calculator/tariffs";
import { prisma } from "@/lib/prisma";
import { requirePermission } from "@/lib/server-auth";

async function authorize() {
  const auth = await requirePermission("settings");
  if (auth.response) return auth;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.ACCOUNTANT)
    return { response: NextResponse.json({ error: "Недостаточно прав" }, { status: 403 }) };
  return auth;
}

export async function GET() {
  const auth = await authorize();
  if (auth.response) return auth.response;
  return NextResponse.json({ items: await getCalculatorTariffs(false) });
}

export async function PATCH(request: Request) {
  const auth = await authorize();
  if (auth.response) return auth.response;
  if (auth.session!.user.role !== Role.DIRECTOR)
    return NextResponse.json({ error: "Бухгалтеру доступен только просмотр" }, { status: 403 });
  try {
    const body = await request.json() as { items?: Array<Record<string, unknown>> };
    if (!Array.isArray(body.items) || body.items.length > 100)
      return NextResponse.json({ error: "Передайте список позиций" }, { status: 400 });
    const items = body.items.map((item, index) => {
      const code = String(item.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_").slice(0, 80);
      const uiName = String(item.uiName ?? "").trim().slice(0, 120);
      const kind = String(item.kind ?? "OTHER_WORK").trim().toUpperCase().slice(0, 50);
      const unit = String(item.unit ?? "").trim().slice(0, 30);
      const salePrice = Number(item.salePrice);
      const internalPrice = Number(item.internalPrice);
      const managerMinimumPrice = Number(item.managerMinimumPrice);
      const defaultQuantity = Number(item.defaultQuantity ?? 0);
      const sortOrder = Number(item.sortOrder ?? index * 10);
      if (!code || !uiName || !kind || !unit || ![salePrice, managerMinimumPrice, internalPrice, defaultQuantity, sortOrder].every(Number.isFinite) || salePrice < 0 || managerMinimumPrice < 0 || managerMinimumPrice > salePrice || internalPrice < 0 || defaultQuantity < 0 || !Number.isInteger(sortOrder))
        throw new Error(`Проверьте позицию «${uiName || code || index + 1}»`);
      return { code, uiName, kind, unit, salePrice, managerMinimumPrice, internalPrice, defaultQuantity, sortOrder, active: item.active !== false, manualPriceAllowed: item.manualPriceAllowed === true };
    });
    if (new Set(items.map((item) => item.code)).size !== items.length)
      return NextResponse.json({ error: "Коды позиций не должны повторяться" }, { status: 400 });
    await prisma.$transaction(items.map((item) => prisma.calculatorTariff.upsert({ where: { code: item.code }, create: item, update: item })));
    return NextResponse.json({ items: await getCalculatorTariffs(false) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось сохранить конфигурацию" }, { status: 400 });
  }
}
