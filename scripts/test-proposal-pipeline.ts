import "./require-test-database";
import { readFileSync } from "node:fs";
import { calculateStair, DELIVERY_CHARGES, STAIR_RATES } from "@/lib/calculator/stair-calculation";
import { companyDisplayPhones, normalizeCompanyPhone } from "@/lib/company-contacts";
import { normalizePhone } from "@/lib/leads/domain";
import { publicCalculationSnapshot } from "@/lib/lead-calculation-view";
import { prisma } from "@/lib/prisma";
import { MATERIAL_PRESENTATION, PROPOSAL_VALIDITY_DAYS } from "@/lib/proposals/presentation";
import { buildProposalPdf } from "@/lib/services/proposal-pdf.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL) throw new Error("Proposal integration requires TEST_DATABASE_URL");
const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };

async function main() {
  const proposalApi = readFileSync("app/api/clients/[id]/proposals/route.ts", "utf8");
  const proposalUi = readFileSync("components/clients/LeadProposalWorkspace.tsx", "utf8");
  const proposalPdf = readFileSync("lib/services/proposal-pdf.service.ts", "utf8");
  for (const contract of ["PROPOSAL_VALIDITY_DAYS * 86400000", "productionLeadDays", "warrantyMonths", "Сосна", "Карагач", "Дуб ламель", "[\"Сосна\", 6]", "[\"Карагач\", 12]", "[\"Дуб ламель\", 60]"])
    assert(proposalApi.includes(contract), `proposal validity/settings contract is missing ${contract}`);
  assert(PROPOSAL_VALIDITY_DAYS === 3, "proposal validity is not 3 calendar days");
  assert(proposalUi.includes("Срок действия истёк") && proposalUi.includes("Действительно до"), "proposal expiry state is missing");
  assert(normalizePhone("8 777 123-45-67") === "+77771234567", "Kazakhstan phone normalization failed");
  assert(normalizePhone("7771234567") === "+77771234567", "ten digit phone normalization failed");
  assert(normalizePhone("123") === "", "invalid phone accepted");
  assert(normalizeCompanyPhone("+7 776 002 7555") === "+77760027555", "secondary company phone normalization failed");
  const lines = [
    { kind: "INSTALLATION" as const, name: "Монтаж", quantity: 1, unit: "заказ", unitCost: 10, unitSale: 20 },
    { kind: "DELIVERY" as const, name: "Доставка", quantity: 1, unit: "рейс", unitCost: 10, unitSale: 20 },
    { kind: "MEASUREMENT" as const, name: "Замер", quantity: 1, unit: "выезд", unitCost: 10, unitSale: 20 },
  ];
  const full = calculateStair({ material: "Сосна", regularSteps: 10, platformEquivalents: [], lines }, STAIR_RATES);
  const excluded = calculateStair({ material: "Сосна", regularSteps: 10, platformEquivalents: [], lines, installationRequired: false, deliveryRequired: false, measurementRequired: false }, STAIR_RATES);
  assert(full.clientPrice - excluded.clientPrice === 60, "service flags do not affect total");
  for (const material of Object.keys(STAIR_RATES) as Array<keyof typeof STAIR_RATES>) {
    const none = calculateStair({ material, regularSteps: 15, platformEquivalents: [2], otherCity: true, deliveryOption: "NONE" }, STAIR_RATES);
    const option1 = calculateStair({ material, regularSteps: 15, platformEquivalents: [2], otherCity: true, deliveryOption: "OPTION_1" }, STAIR_RATES);
    const option2 = calculateStair({ material, regularSteps: 15, platformEquivalents: [2], otherCity: true, deliveryOption: "OPTION_2" }, STAIR_RATES);
    assert(option1.clientPrice - none.clientPrice === DELIVERY_CHARGES.OPTION_1, `${material}: delivery OPTION_1 is not included`);
    assert(option2.clientPrice - none.clientPrice === DELIVERY_CHARGES.OPTION_2, `${material}: delivery OPTION_2 is not included`);
    assert(option2.deliveryOption === "OPTION_2" && option2.deliveryCharge === 500_000, `${material}: delivery snapshot is incorrect`);
  }
  for (const forbidden of ["Доставка не включена", "Доставка не входит", "Замер включён", "Монтаж — 1 заказ", "Замер — 1 выезд", "Доставка — 1 рейс", "Срок уточняется после замера", "Гарантия согласно договору"])
    assert(!proposalPdf.includes(forbidden), `PDF template contains forbidden client text: ${forbidden}`);
  for (const required of ["В СТОИМОСТЬ ВХОДИТ", "СРОК ИЗГОТОВЛЕНИЯ", "СРОК ДЕЙСТВИЯ КП", "ГОТОВЫ ОБСУДИТЬ ВАШ ПРОЕКТ", "ОФИЦИАЛЬНЫЕ ТЕЛЕФОНЫ", "companyDisplayPhones", "КАЧЕСТВО.  ОТВЕТСТВЕННОСТЬ.  РЕЗУЛЬТАТ."])
    assert(proposalPdf.includes(required), `PDF template is missing ${required}`);
  assert(MATERIAL_PRESENTATION.Сосна.description.includes("Практичное решение"), "pine selling copy missing");
  assert(MATERIAL_PRESENTATION.Карагач.description.includes("высокая прочность"), "elm selling copy missing");
  assert(MATERIAL_PRESENTATION["Дуб ламель"].description.includes("Премиальный материал"), "oak selling copy missing");
  const publicValue = JSON.stringify(publicCalculationSnapshot({ purchaseCost: 1, margin: 2, internalCoefficient: 3, unitCost: 4, nested: { grossProfit: 5 }, safe: "ok" }));
  for (const secret of ["purchaseCost", "margin", "internalCoefficient", "unitCost", "grossProfit"]) assert(!publicValue.includes(secret), `public DTO leaks ${secret}`);
  const sequenceValues = await Promise.all(Array.from({ length: 50 }, () => prisma.$queryRaw<Array<{ value: bigint }>>`SELECT nextval('commercial_proposal_number_seq') AS value`));
  assert(new Set(sequenceValues.map((row) => row[0].value.toString())).size === 50, "proposal sequence is not concurrency safe");
  const companyPhones = companyDisplayPhones();
  const pdf = await buildProposalPdf({ number: "100000", createdAt: new Date().toISOString(), validUntil: new Date(Date.now() + PROPOSAL_VALIDITY_DAYS * 86400000).toISOString(), company: { name: "ALTYN SAPA COMPANY", phone: companyPhones[0], secondaryPhone: companyPhones[1], phones: companyPhones }, client: { name: "Клиент", phone: "+7 777 123 45 67", city: "Алматы" }, variants: [{ material: "Сосна", total: 1_950_000, executionTerm: "40–50 календарных дней", warranty: "6 месяцев" }, { material: "Карагач", total: 2_400_000, executionTerm: "40–50 календарных дней", warranty: "1 год" }, { material: "Дуб ламель", total: 2_850_000, executionTerm: "40–50 календарных дней", warranty: "5 лет" }], purchaseCost: 1, margin: 1 });
  assert(pdf.subarray(0, 5).toString("ascii") === "%PDF-" && pdf.length > 5_000, "real PDF was not generated");
  assert((pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length === 1, "proposal PDF must fit one A4 page");
  assert(!pdf.toString("utf8").includes("purchaseCost") && !pdf.toString("utf8").includes("margin"), "PDF leaks internal fields");
  console.log("proposal pipeline phone, flags, redaction, sequence and PDF checks passed");
}
void main().finally(() => prisma.$disconnect());
