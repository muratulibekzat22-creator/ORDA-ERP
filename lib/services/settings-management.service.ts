import { Prisma } from "@prisma/client";

import { getPermissionMatrix, replacePermissionMatrix } from "@/lib/services/permission.service";
import { prisma } from "@/lib/prisma";

const companyFields = ["name", "bin", "legalAddress", "actualAddress", "phone", "whatsapp", "email", "bankDetails", "directorName", "logoUrl"] as const;
const systemStringFields = ["currency", "timezone", "dateFormat", "offerPrefix", "contractPrefix", "actPrefix", "invoicePrefix"] as const;
const systemNumberFields = ["minimumPrepayment", "measurementLeadDays", "measurerOrderBonus", "productionLeadDays", "installationLeadDays", "nextDocumentNumber"] as const;
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
  const [company, system, calculator, materials, rolePermissions] = await Promise.all([
    prisma.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    prisma.systemSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    prisma.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    prisma.material.findMany({ select: { id: true, name: true, category: true, unit: true, purchasePrice: true, active: true, _count: { select: { movements: true } } }, orderBy: { name: "asc" } }),
    getPermissionMatrix(),
  ]);
  return { company, system, calculator, materials, rolePermissions };
}

export async function patchSettingsManagement(payload: unknown) {
  const body = object(payload);
  if (!body) throw new Error("INVALID_SETTINGS");
  const company = body.company === undefined ? null : object(body.company);
  const system = body.system === undefined ? null : object(body.system);
  const calculator = body.calculator === undefined ? null : object(body.calculator);
  if ((body.company !== undefined && !company) || (body.system !== undefined && !system) || (body.calculator !== undefined && !calculator)) throw new Error("INVALID_SETTINGS");
  if (company && "email" in company && typeof company.email === "string" && company.email && (!company.email.includes("@") || company.email.length > 254)) throw new Error("INVALID_SETTINGS");
  if (system && "currency" in system && system.currency !== "KZT") throw new Error("INVALID_SETTINGS");
  if (system && "timezone" in system && system.timezone !== "Asia/Almaty") throw new Error("INVALID_SETTINGS");

  const [nextCompany, nextSystem, nextCalculator] = await prisma.$transaction(async (tx) => Promise.all([
    company ? tx.companySettings.upsert({ where: { id: 1 }, create: { id: 1, ...strings(company, companyFields) }, update: strings(company, companyFields) as Prisma.CompanySettingsUpdateInput }) : tx.companySettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    system ? tx.systemSettings.upsert({ where: { id: 1 }, create: { id: 1, ...strings(system, systemStringFields), ...nonNegativeIntegers(system, systemNumberFields) }, update: { ...strings(system, systemStringFields), ...nonNegativeIntegers(system, systemNumberFields) } as Prisma.SystemSettingsUpdateInput }) : tx.systemSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    calculator ? tx.settings.upsert({ where: { id: 1 }, create: { id: 1, ...nonNegativeIntegers(calculator, calculatorFields) }, update: nonNegativeIntegers(calculator, calculatorFields) }) : tx.settings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
  ]));
  const rolePermissions = body.rolePermissions === undefined ? await getPermissionMatrix() : await replacePermissionMatrix(body.rolePermissions);
  return { company: nextCompany, system: nextSystem, calculator: nextCalculator, rolePermissions };
}
