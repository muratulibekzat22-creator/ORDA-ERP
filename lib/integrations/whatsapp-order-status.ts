import { DocumentType, PartnerBusinessStatus, Prisma } from "@prisma/client";

import { normalizePhone } from "@/lib/leads/domain";
import { projectOrderStatus, type UserOrderStatus } from "@/lib/orders/presentation";
import { prisma } from "@/lib/prisma";

export type WhatsappOrderLookup =
  | { lookupType: "phone"; value: string }
  | { lookupType: "contract"; value: string };

export type WhatsappOrderStatusItem = {
  orderNumber: string;
  contractNumber: string | null;
  lifecycle: string;
  userStatus: UserOrderStatus;
  productionStage: string | null;
  productionPercent: number | null;
  partnerPlannedReadyAt: string | null;
  productionDeadline: string | null;
  promisedAt: string | null;
  updatedAt: string;
  responsible: {
    name: string;
    phone: string;
  } | null;
};

export type WhatsappOrderStatusResult = {
  matched: boolean;
  hasMore: boolean;
  orders: WhatsappOrderStatusItem[];
};

export type WhatsappPartnerReadiness = {
  key: "islam" | "rakhmatulla";
  expectedName: string;
  found: boolean;
  id: number | null;
  name: string | null;
  active: boolean;
  archived: boolean;
  businessStatus: string | null;
  managementDirectory: boolean;
  hasUserAccount: boolean;
  orderCount: number;
  settlementOrderCount: number;
  nameMatchFound: boolean;
  nameMatchHasPhone: boolean;
  nameMatchActive: boolean;
  nameMatchArchived: boolean;
  nameMatchBusinessStatus: string | null;
  nameMatchManagementDirectory: boolean;
  nameMatchHasUserAccount: boolean;
  nameMatchOrderCount: number;
};

const REQUIRED_PARTNERS = [
  { key: "islam", expectedName: "Ислам", phone: "+77712546464" },
  { key: "rakhmatulla", expectedName: "Рахматулла", phone: "+77473573031" },
] as const;

export function normalizeWhatsappOrderLookup(input: WhatsappOrderLookup): WhatsappOrderLookup | null {
  if (input.lookupType === "phone") {
    const phone = normalizePhone(input.value);
    return phone ? { lookupType: "phone", value: phone } : null;
  }
  const contract = input.value
    .trim()
    .replace(/^(?:договор|шарт|contract)\s*(?:№|#|no\.?|номер)?\s*/iu, "")
    .trim()
    .slice(0, 80);
  return contract ? { lookupType: "contract", value: contract } : null;
}

function exactPhoneVariants(canonicalPhone: string) {
  const digits = canonicalPhone.slice(1);
  return [...new Set([canonicalPhone, digits, `8${digits.slice(1)}`])];
}

function toIso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

const orderStatusSelect = {
  number: true,
  lifecycle: true,
  partnerPlannedReadyAt: true,
  productionDeadline: true,
  promisedAt: true,
  updatedAt: true,
  partner: {
    select: {
      name: true,
      phone: true,
      secondaryPhone: true,
      active: true,
      archived: true,
      businessStatus: true,
    },
  },
  productions: {
    where: { archivedAt: null },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: { stage: true, percent: true },
  },
  documents: {
    where: { type: DocumentType.CONTRACT },
    orderBy: [{ documentDate: "desc" }, { id: "desc" }],
    take: 1,
    select: { number: true },
  },
} satisfies Prisma.OrderSelect;

type SelectedOrder = Prisma.OrderGetPayload<{ select: typeof orderStatusSelect }>;

export function presentWhatsappOrderStatus(order: SelectedOrder): WhatsappOrderStatusItem {
  const partner = order.partner;
  const partnerPhone = partner ? normalizePhone(partner.phone || partner.secondaryPhone || "") : "";
  const responsible =
    partner && partner.active && !partner.archived && partner.businessStatus === PartnerBusinessStatus.ACTIVE && partnerPhone
      ? { name: partner.name, phone: partnerPhone }
      : null;
  const production = order.productions[0] ?? null;
  return {
    orderNumber: order.number,
    contractNumber: order.documents[0]?.number ?? null,
    lifecycle: order.lifecycle,
    userStatus: projectOrderStatus(order.lifecycle),
    productionStage: production?.stage ?? null,
    productionPercent: production?.percent ?? null,
    partnerPlannedReadyAt: toIso(order.partnerPlannedReadyAt),
    productionDeadline: toIso(order.productionDeadline),
    promisedAt: toIso(order.promisedAt),
    updatedAt: order.updatedAt.toISOString(),
    responsible,
  };
}

export async function lookupWhatsappOrderStatus(
  rawLookup: WhatsappOrderLookup,
): Promise<WhatsappOrderStatusResult> {
  const lookup = normalizeWhatsappOrderLookup(rawLookup);
  if (!lookup) throw new Error("INVALID_LOOKUP");

  const where: Prisma.OrderWhereInput =
    lookup.lookupType === "phone"
      ? {
          deletedAt: null,
          client: {
            active: true,
            deletedAt: null,
            OR: exactPhoneVariants(lookup.value).flatMap((phone) => [
              { phone },
              { whatsapp: phone },
            ]),
          },
        }
      : {
          deletedAt: null,
          documents: {
            some: {
              type: DocumentType.CONTRACT,
              number: { equals: lookup.value, mode: "insensitive" },
            },
          },
        };

  const rows = await prisma.order.findMany({
    where,
    select: orderStatusSelect,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 6,
  });
  return {
    matched: rows.length > 0,
    hasMore: rows.length > 5,
    orders: rows.slice(0, 5).map(presentWhatsappOrderStatus),
  };
}

export async function getWhatsappPartnerReadiness(): Promise<WhatsappPartnerReadiness[]> {
  const partners = await prisma.partner.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      secondaryPhone: true,
      active: true,
      archived: true,
      businessStatus: true,
      managementDirectory: true,
      userId: true,
      _count: { select: { orders: true, orderRelations: true } },
    },
    orderBy: { id: "asc" },
  });
  return REQUIRED_PARTNERS.map((required) => {
    const partner = partners.find((candidate) =>
      [candidate.phone, candidate.secondaryPhone]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizePhone(value) === required.phone),
    );
    const normalizedExpectedName = required.expectedName.toLocaleLowerCase("ru");
    const nameMatch = partners.find((candidate) =>
      candidate.name.trim().toLocaleLowerCase("ru") === normalizedExpectedName,
    );
    return {
      key: required.key,
      expectedName: required.expectedName,
      found: Boolean(partner),
      id: partner?.id ?? null,
      name: partner?.name ?? null,
      active: partner?.active === true,
      archived: partner?.archived === true,
      businessStatus: partner?.businessStatus ?? null,
      managementDirectory: partner?.managementDirectory === true,
      hasUserAccount: partner?.userId != null,
      orderCount: partner?._count.orders ?? 0,
      settlementOrderCount: partner?._count.orderRelations ?? 0,
      nameMatchFound: Boolean(nameMatch),
      nameMatchHasPhone: Boolean(nameMatch && normalizePhone(nameMatch.phone || nameMatch.secondaryPhone || "")),
      nameMatchActive: nameMatch?.active === true,
      nameMatchArchived: nameMatch?.archived === true,
      nameMatchBusinessStatus: nameMatch?.businessStatus ?? null,
      nameMatchManagementDirectory: nameMatch?.managementDirectory === true,
      nameMatchHasUserAccount: nameMatch?.userId != null,
      nameMatchOrderCount: nameMatch?._count.orders ?? 0,
    };
  });
}
