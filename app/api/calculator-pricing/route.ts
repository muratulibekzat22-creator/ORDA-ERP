import { Role } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCalculatorTariffs, redactTariffs } from "@/lib/calculator/tariffs";
import { calculateStair, DELIVERY_CHARGES, type CalculationLineInput, type DeliveryOption, type StairMaterial, type StairRates } from "@/lib/calculator/stair-calculation";
import { MATERIAL_CODES, tariffMap } from "@/lib/calculator/tariffs";
import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";
import { requirePermission } from "@/lib/server-auth";

export async function GET() {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER && role !== Role.ACCOUNTANT)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  return NextResponse.json({ items: redactTariffs(await getCalculatorTariffs(), role), deliveryOptions: DELIVERY_CHARGES });
}

export async function POST(request: Request) {
  const auth = await requirePermission("orders");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role;
  if (role !== Role.DIRECTOR && role !== Role.MANAGER && role !== Role.ACCOUNTANT)
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    if ("internalCost" in body || "workshopCost" in body || "clientPrice" in body)
      return NextResponse.json({ error: "Внутренние и итоговые цены задаются сервером" }, { status: 403 });
    const tariffs = await getCalculatorTariffs(), byCode = tariffMap(tariffs);
    const rates = Object.fromEntries(Object.entries(MATERIAL_CODES).map(([name, code]) => {
      const tariff = byCode.get(code);
      if (!tariff) throw new Error("Тариф материала не настроен");
      return [name, { workshopRate: tariff.internalPrice, saleRate: tariff.salePrice }];
    })) as StairRates;
    const lines: CalculationLineInput[] = (Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : []).map((line) => {
      const tariff = typeof line.code === "string" ? byCode.get(line.code) : undefined;
      if (!tariff) throw new Error("Позиция калькулятора не найдена");
      return { code: tariff.code, kind: tariff.kind as CalculationLineInput["kind"], name: tariff.uiName, quantity: Number(line.quantity ?? tariff.defaultQuantity), unit: tariff.unit, unitCost: tariff.internalPrice, unitSale: tariff.salePrice, enabled: line.enabled !== false };
    });
    const platformEquivalents = Array.isArray(body.platformEquivalents) ? body.platformEquivalents.map(Number) : [];
    const input = { regularSteps: Number(body.regularSteps), platformEquivalents, installationRequired: body.installationRequired !== false, deliveryRequired: body.deliveryRequired !== false, measurementRequired: body.measurementRequired !== false, otherCity: body.otherCity === true, pickup: body.pickup === true, deliveryOption: body.deliveryOption as DeliveryOption | undefined, lines };
    const variants = (Object.keys(MATERIAL_CODES) as StairMaterial[]).map((material) => {
      const calculated = calculateStair({ ...input, material }, rates);
      return publicCalculationSnapshot({ material, clientPrice: calculated.clientPrice, deliveryOption: calculated.deliveryOption, deliveryCharge: calculated.deliveryCharge });
    });
    return NextResponse.json({ variants, deliveryOptions: DELIVERY_CHARGES });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Некорректный расчёт" }, { status: 400 });
  }
}
