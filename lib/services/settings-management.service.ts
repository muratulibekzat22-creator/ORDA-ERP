import { Prisma } from "@prisma/client";

import { normalizeCompanyPhone } from "@/lib/company-contacts";
import { getPermissionMatrix, replacePermissionMatrix } from "@/lib/services/permission.service";
import { prisma } from "@/lib/prisma";
import { requireTenantIdentity } from "@/lib/tenant-context";

const companyFields = ["name", "bin", "legalAddress", "actualAddress", "phone", "secondaryPhone", "whatsapp", "email", "bankDetails", "directorName", "directorFullName", "iik", "bank", "bik", "logoUrl"] as const;
const systemStringFields = ["currency", "timezone", "dateFormat", "offerPrefix", "contractPrefix", "actPrefix", "invoicePrefix"] as const;
const systemNumberFields = ["minimumPrepayment", "measurementLeadDays", "measurerOrderBonus", "productionLeadDays", "installationLeadDays", "paydayDayOfMonth", "nextDocumentNumber", "nextContractNumber"] as const;
const calculatorFields = ["pinePrice", "elmPrice", "oakPrice", "woodRailing", "glassRailing", "brassRailing", "ledPrice", "paintingPrice", "installationPrice"] as const;

type RecordValue = Record<string, unknown>;

function object(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function strings(value: RecordValue, fields: readonly string[]) {
  const data: Record<string, string> = {};
  for (const field of fields) {
    if (!(field in value)) continue;
    if (typeof value[field] !== "string" || value[field].trim().length > 1000) throw new Error("INVALID_SETTINGS");
    data[field] = value[field].trim();
  }
  return data;
}

function companyStrings(value: RecordValue) {
  const data = strings(value, companyFields);
  for (const field of ["phone", "secondaryPhone"] as const) {
    if (!(field in data) || !data[field]) continue;
    const normalized = normalizeCompanyPhone(data[field]);
    if (!normalized) throw new Error("INVALID_SETTINGS");
    data[field] = normalized;
  }
  return data;
}

function nonNegativeIntegers(value: RecordValue, fields: readonly string[]) {
  const data: Record<string, number> = {};
  for (const field of fields) {
    if (!(field in value)) continue;
    const number = Number(value[field]);
    if (!Number.isInteger(number) || number < 0 || number > 1000000000) throw new Error("INVALID_SETTINGS");
    data[field] = number;
  }
  return data;
}

export async function getSettingsManagement() {
  const companyId = requireTenantIdentity().companyId;
  const [company, system, calculator, materials, rolePermissions, partners] = await Promise.all([
    prisma.companySettings.upsert({
      where: { companyId },
      create: {},
      update: {},
      include: { defaultWorkshopPartner: { select: { id: true, name: true } } },
    }),
    prisma.systemSettings.upsert({ where: { companyId }, create: {}, update: {} }),
    prisma.settings.upsert({ where: { companyId }, create: {}, update: {} }),
    prisma.material.findMany({ select: { id: true, name: true, category: true, unit: true, purchasePrice: true, warrantyMonths: true, active: true, _count: { select: { movements: true } } }, orderBy: { name: "asc" } }),
    getPermissionMatrix(),
    prisma.partner.findMany({
      where: { companyId, active: true, archived: false, isTest: false, businessStatus: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { company, system, calculator, materials, rolePermissions, partners };
}

export async function patchSettingsManagement(payload: unknown) {
  const companyId = requireTenantIdentity().companyId;
  const body = object(payload);
  if (!body) throw new Error("INVALID_SETTINGS");
  const company = body.company === undefined ? null : object(body.company);
  const system = body.system === undefined ? null : object(body.system);
  const calculator = body.calculator === undefined ? null : object(body.calculator);
  if ((body.company !== undefined && !company) || (body.system !== undefined && !system) || (body.calculator !== undefined && !calculator)) throw new Error("INVALID_SETTINGS");
  if (company && "email" in company && typeof company.email === "string" && company.email && (!company.email.includes("@") || company.email.length > 254)) throw new Error("INVALID_SETTINGS");
  if (system && "currency" in system && system.currency !== "KZT") throw new Error("INVALID_SETTINGS");
  if (system && "timezone" in system && system.timezone !== "Asia/Almaty") throw new Error("INVALID_SETTINGS");
  let defaultWorkshopPartnerId: number | null | undefined;
  if (company && "defaultWorkshopPartnerId" in company) {
    const raw = company.defaultWorkshopPartnerId;
    defaultWorkshopPartnerId = raw === "" || raw === null ? null : Number(raw);
    if (!Number.isInteger(defaultWorkshopPartnerId) || (defaultWorkshopPartnerId ?? 0) <= 0) {
      if (defaultWorkshopPartnerId !== null) throw new Error("INVALID_SETTINGS");
    } else {
      const partnerId = defaultWorkshopPartnerId as number;
      const partner = await prisma.partner.findFirst({
        where: { id: partnerId, companyId, active: true, archived: false, isTest: false, businessStatus: "ACTIVE" },
        select: { id: true },
      });
      if (!partner) throw new Error("INVALID_SETTINGS");
    }
  }
  const systemNumbers = system ? nonNegativeIntegers(system, systemNumberFields) : {};
  if ("paydayDayOfMonth" in systemNumbers && (systemNumbers.paydayDayOfMonth < 1 || systemNumbers.paydayDayOfMonth > 28))
    throw new Error("INVALID_SETTINGS");

  const [nextCompany, nextSystem, nextCalculator] = await prisma.$transaction(async (tx) => Promise.all([
    company ? tx.companySettings.upsert({
      where: { companyId },
      create: {
        ...companyStrings(company),
        ...(defaultWorkshopPartnerId ? { defaultWorkshopPartnerId } : {}),
      } as Prisma.CompanySettingsUncheckedCreateInput,
      update: {
        ...companyStrings(company),
        ...(defaultWorkshopPartnerId === undefined
          ? {}
          : { defaultWorkshopPartnerId }),
      } as Prisma.CompanySettingsUncheckedUpdateInput,
    }) : tx.companySettings.upsert({ where: { companyId }, create: {}, update: {} }),
    system ? tx.systemSettings.upsert({ where: { companyId }, create: { ...strings(system, systemStringFields), ...systemNumbers }, update: { ...strings(system, systemStringFields), ...systemNumbers } as Prisma.SystemSettingsUpdateInput }) : tx.systemSettings.upsert({ where: { companyId }, create: {}, update: {} }),
    calculator ? tx.settings.upsert({ where: { companyId }, create: { ...nonNegativeIntegers(calculator, calculatorFields) }, update: nonNegativeIntegers(calculator, calculatorFields) }) : tx.settings.upsert({ where: { companyId }, create: {}, update: {} }),
  ]));
  const rolePermissions = body.rolePermissions === undefined ? await getPermissionMatrix() : await replacePermissionMatrix(body.rolePermissions);
  return { company: nextCompany, system: nextSystem, calculator: nextCalculator, rolePermissions };
}
