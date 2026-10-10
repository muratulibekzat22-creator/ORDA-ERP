import "dotenv/config";

import { Role } from "@prisma/client";

import { normalizeBrassModelQuantities, totalBrassPairs, type BrassModelQuantities } from "@/lib/brass/catalog";
import { createRequestHash } from "@/lib/idempotency";
import { prisma } from "@/lib/prisma";
import { createBrassProcurement } from "@/lib/services/brass-procurement.service";
import { runWithSystemAccess, runWithTenant } from "@/lib/tenant-context";

type ReleaseTarget = {
  number: string;
  clientName: string;
  amount: number;
  models: BrassModelQuantities;
};

const targets: ReleaseTarget[] = [
  {
    number: "ORD-20261001-D3A27853D493",
    clientName: "Гульзира Копеева",
    amount: 2_800_000,
    models: { OVAL_BLACK: 0, OVAL_WHITE: 45, SQUARE_BLACK: 0 },
  },
  {
    number: "ORD-20261002-AF2FF2EFFCBE",
    clientName: "Нургуль Латун Дуб ламил",
    amount: 2_200_000,
    models: { OVAL_BLACK: 26, OVAL_WHITE: 0, SQUARE_BLACK: 0 },
  },
  {
    number: "ORD-20261002-E4E7B5373825",
    clientName: "Мира Астана",
    amount: 3_800_000,
    models: { OVAL_BLACK: 15, OVAL_WHITE: 0, SQUARE_BLACK: 0 },
  },
];

function sameModels(left: unknown, right: BrassModelQuantities) {
  const normalized = normalizeBrassModelQuantities(left);
  return Object.entries(right).every(([key, value]) => normalized[key as keyof BrassModelQuantities] === value);
}

async function main() {
  const company = await runWithSystemAccess(() => prisma.company.findFirst({
    where: { id: 1, active: true, isDemo: false },
    select: { id: true, slug: true, name: true, isDemo: true },
  }));
  if (!company) throw new Error("Live company is unavailable");

  const result = await runWithTenant(
    {
      companyId: company.id,
      companySlug: company.slug,
      companyName: company.name,
      isDemo: company.isDemo,
    },
    async () => {
      const actorUser = await prisma.user.findFirst({
        where: { id: 1, active: true, role: Role.DIRECTOR },
        select: { id: true, name: true, role: true },
      });
      if (!actorUser) throw new Error("Director actor is unavailable");
      const actor = { userId: actorUser.id, name: actorUser.name, role: actorUser.role };

      const orders = [];
      for (const target of targets) {
        const order = await prisma.order.findFirst({
          where: { number: target.number, deletedAt: null },
          select: {
            id: true,
            number: true,
            amount: true,
            client: { select: { name: true } },
            brassProcurement: {
              select: {
                id: true,
                status: true,
                quantityPairs: true,
                modelQuantities: true,
                costBearer: true,
              },
            },
          },
        });
        if (!order) throw new Error(`Active order ${target.number} was not found`);
        if (order.client.name !== target.clientName || Number(order.amount) !== target.amount)
          throw new Error(`Order identity check failed for ${target.number}`);
        if (order.brassProcurement && (
          order.brassProcurement.status === "CANCELLED" ||
          Number(order.brassProcurement.quantityPairs) !== totalBrassPairs(target.models) ||
          order.brassProcurement.costBearer !== "COMPANY" ||
          !sameModels(order.brassProcurement.modelQuantities, target.models)
        )) throw new Error(`Existing brass request differs from the approved data for ${target.number}`);
        orders.push({ target, order });
      }

      const prepared = [];
      for (const { target, order } of orders) {
        if (order.brassProcurement) {
          prepared.push({
            order: order.number.slice(-4),
            requestId: order.brassProcurement.id,
            pairs: Number(order.brassProcurement.quantityPairs),
            status: order.brassProcurement.status,
            created: false,
          });
          continue;
        }
        const payload = {
          orderId: order.id,
          modelQuantities: target.models,
          costBearer: "COMPANY" as const,
          notes: "Заявка руководителя. Фактическую стоимость латуни и карго укажет склад.",
        };
        const created = await createBrassProcurement({
          ...payload,
          key: `brass-release:2026-10-10:${order.number}`,
          requestHash: createRequestHash(payload),
          actor,
        });
        prepared.push({
          order: order.number.slice(-4),
          requestId: created.procurement.id,
          pairs: created.procurement.quantityPairs,
          status: created.procurement.status,
          created: created.created,
        });
      }
      return prepared;
    },
  );

  console.log(`Brass applications prepared: ${JSON.stringify(result)}`);
}

main().finally(() => prisma.$disconnect());
