import { Prisma, Role } from "@prisma/client";
import { NextResponse } from "next/server";

import {
  createRequestHash,
  idempotencyConflict,
  readIdempotencyKey,
} from "@/lib/idempotency";
import { companyDisplayPhones } from "@/lib/company-contacts";
import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";
import { warrantyLabel } from "@/lib/contracts/domain";
import { prisma } from "@/lib/prisma";
import { PROPOSAL_VALIDITY_DAYS } from "@/lib/proposals/presentation";
import { requirePermission } from "@/lib/server-auth";

type Context = { params: Promise<{ id: string }> };
const idOf = async (context: Context) => {
  const id = Number((await context.params).id);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function proposalView(value: Record<string, unknown>) {
  const result: Record<string, unknown> = {
    ...value,
    snapshot: publicCalculationSnapshot(value.snapshot),
  };
  delete result.requestHash;
  delete result.idempotencyKey;
  delete result.sendIdempotencyKey;
  delete result.providerMessageId;
  if (result.calculation && typeof result.calculation === "object") {
    const source = result.calculation as Record<string, unknown>;
    result.calculation = {
      id: source.id,
      material: source.material,
      clientPrice: source.clientPrice,
      snapshot: publicCalculationSnapshot(source.snapshot),
    };
  }
  return result;
}

async function ownedClient(clientId: number, role: Role, userId: number) {
  return prisma.client.findFirst({
    where: {
      id: clientId,
      ...(role === Role.MANAGER ? { managerUserId: userId } : {}),
    },
  });
}

export async function GET(_: Request, context: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role,
    clientId = await idOf(context);
  if (!clientId || (role !== Role.DIRECTOR && role !== Role.MANAGER))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  if (!(await ownedClient(clientId, role, Number(auth.session!.user.id))))
    return NextResponse.json({ error: "Заявка не найдена" }, { status: 404 });
  const rows = await prisma.commercialProposal.findMany({
    where: { clientId },
    include: { calculation: true, conversion: { select: { orderId: true } } },
    orderBy: [{ createdAt: "desc" }, { version: "desc" }],
  });
  return NextResponse.json(
    rows.map((row) => proposalView(row as unknown as Record<string, unknown>)),
  );
}

export async function POST(request: Request, context: Context) {
  const auth = await requirePermission("clients");
  if (auth.response) return auth.response;
  const role = auth.session!.user.role as Role,
    clientId = await idOf(context),
    userId = Number(auth.session!.user.id);
  if (!clientId || (role !== Role.DIRECTOR && role !== Role.MANAGER))
    return NextResponse.json({ error: "Недостаточно прав" }, { status: 403 });
  const idempotency = readIdempotencyKey(request);
  if ("response" in idempotency) return idempotency.response;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if ("number" in body || "rootNumber" in body || "createdById" in body)
      return NextResponse.json(
        { error: "Служебные поля назначаются сервером" },
        { status: 400 },
      );
    const requestedIds = (
      Array.isArray(body.calculationIds)
        ? body.calculationIds
        : [body.calculationId]
    )
      .map(Number)
      .filter((id) => Number.isInteger(id) && id > 0);
    const requestHash = createRequestHash({
      clientId,
      calculationIds: [...requestedIds].sort(),
      previousProposalId: body.previousProposalId ?? null,
      validDays: PROPOSAL_VALIDITY_DAYS,
      executionTerm: "FROM_SETTINGS",
      paymentTerms: body.paymentTerms ?? null,
      warranty: "FROM_MATERIALS",
    });
    const existing = await prisma.commercialProposal.findUnique({
      where: { idempotencyKey: idempotency.key },
      include: { calculation: true },
    });
    if (existing)
      return existing.requestHash === requestHash
        ? NextResponse.json(
            proposalView(existing as unknown as Record<string, unknown>),
          )
        : idempotencyConflict();
    const [client, calculations, settings, system, materials] = await Promise.all([
      ownedClient(clientId, role, userId),
      prisma.leadCalculation.findMany({
        where: { id: { in: requestedIds }, clientId },
      }),
      prisma.companySettings.findUnique({ where: { id: 1 } }),
      prisma.systemSettings.findUnique({ where: { id: 1 } }),
      prisma.material.findMany({
        where: {
          active: true,
          name: { in: ["Сосна", "Карагач", "Дуб ламель"] },
        },
        select: { name: true, warrantyMonths: true },
      }),
    ]);
    const productionDays = system?.productionLeadDays || 40;
    const executionTerm =
      productionDays === 40
        ? "40–50 календарных дней"
        : `${productionDays} календарных дней`;
    const materialSettings = new Map(
      materials.map((item) => [item.name, item.warrantyMonths]),
    );
    const defaultWarrantyMonths = new Map([
      ["Сосна", 6],
      ["Карагач", 12],
      ["Дуб ламель", 60],
    ]);
    const warrantyByMaterial = new Map(
      [...defaultWarrantyMonths].map(([name, defaultMonths]) => [
        name,
        warrantyLabel(materialSettings.get(name) ?? defaultMonths),
      ]),
    );
    const byMaterial = new Map(
      calculations.map((item) => [item.material, item]),
    );
    const ordered = ["Сосна", "Карагач", "Дуб ламель"]
      .map((material) => byMaterial.get(material))
      .filter((item): item is NonNullable<typeof item> => Boolean(item));
    if (!client || ordered.length !== 3)
      return NextResponse.json(
        { error: "Для КП нужны три варианта расчёта" },
        { status: 404 },
      );
    const previous = body.previousProposalId
      ? await prisma.commercialProposal.findFirst({
          where: { id: Number(body.previousProposalId), clientId },
        })
      : null;
    const now = new Date(),
      version = previous ? previous.version + 1 : 1;
    const variants = ordered.map((item) => {
      const calculation = publicCalculationSnapshot(item.snapshot) as Record<
        string,
        unknown
      >;
      return {
        material: item.material,
        total: Number(item.clientPrice),
        composition: calculation.lines ?? [],
        executionTerm,
        warranty: warrantyByMaterial.get(item.material) ?? "по материалу",
        includedServices: {
          measurement:
            calculation.includeMeasurement ??
            calculation.measurementRequired ??
            false,
          delivery: calculation.deliveryRequired ?? false,
          installation: calculation.installationRequired ?? false,
        },
        deliveryOption: calculation.deliveryOption ?? "NONE",
        deliveryCharge: Number(calculation.deliveryCharge ?? 0),
      };
    });
    const deliveryOptions = new Set(variants.map((item) => item.deliveryOption));
    if (deliveryOptions.size !== 1)
      return NextResponse.json({ error: "Варианты расчёта должны использовать одну доставку" }, { status: 400 });
    const deliveryOption = variants[0].deliveryOption;
    const deliveryCharge = variants[0].deliveryCharge;
    const total = Math.max(...variants.map((item) => item.total));
    const result = await prisma.$transaction(
      async (tx) => {
        const rootNumber =
          previous?.rootNumber ??
          previous?.number ??
          String(
            (
              await tx.$queryRaw<
                Array<{ value: bigint }>
              >`SELECT nextval('commercial_proposal_number_seq') AS value`
            )[0].value,
          );
        const number = version === 1 ? rootNumber : `${rootNumber}-V${version}`;
        const companyPhones = companyDisplayPhones(settings);
        const snapshot = JSON.parse(
          JSON.stringify({
            company: {
              name: settings?.name ?? "ALTYN SAPA COMPANY",
              phone: companyPhones[0],
              secondaryPhone: companyPhones[1] ?? "",
              phones: companyPhones,
              whatsapp: settings?.whatsapp ?? "",
              email: settings?.email ?? "",
            },
            client: {
              name: client.name,
              phone: client.phone,
              city: client.city,
            },
            variants,
            introduction:
              "Предлагаем изготовление лестницы по индивидуальным размерам объекта. Выберите подходящий материал — итоговая стоимость, срок и гарантия указаны для каждого варианта.",
            delivery: { option: deliveryOption, amount: deliveryCharge },
            paymentTerms: String(
              body.paymentTerms ??
                "Условия оплаты согласовываются при оформлении заказа",
            ),
            validUntil: new Date(
              now.getTime() + PROPOSAL_VALIDITY_DAYS * 86400000,
            ).toISOString(),
            createdAt: now.toISOString(),
            number: rootNumber,
            version,
          }),
        );
        const created = await tx.commercialProposal.create({
          data: {
            clientId,
            calculationId: ordered[1].id,
            number,
            rootNumber,
            version,
            status: "GENERATED",
            snapshot,
            total,
            validUntil: new Date(snapshot.validUntil),
            executionTerm: executionTerm.slice(0, 200),
            paymentTerms: String(
              body.paymentTerms ??
                "Условия оплаты согласовываются при оформлении заказа",
            ).slice(0, 500),
            warranty: variants.map((item) => `${item.material}: ${item.warranty}`).join("; ").slice(0, 300),
            managerContact: companyPhones.join(", "),
            createdById: userId,
            createdByName: auth.session!.user.name ?? client.manager,
            idempotencyKey: idempotency.key,
            requestHash,
          },
        });
        await tx.client.update({
          where: { id: clientId },
          data: { status: "КП подготовлено" },
        });
        await tx.leadStatusHistory.create({
          data: {
            clientId,
            fromStatus: client.status,
            toStatus: "КП подготовлено",
            authorId: userId,
            authorName: auth.session!.user.name ?? client.manager,
          },
        });
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return NextResponse.json(
      proposalView(result as unknown as Record<string, unknown>),
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return idempotencyConflict();
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Не удалось сформировать КП",
      },
      { status: 400 },
    );
  }
}
