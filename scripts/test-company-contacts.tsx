import "./require-test-database";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";

import CommercialProposal from "@/components/documents/CommercialProposal";
import Invoice from "@/components/documents/Invoice";
import WorkCompletionAct from "@/components/documents/WorkCompletionAct";
import type { DocumentOrder } from "@/components/documents/types";
import {
  companyDisplayPhones,
  companyPhoneValues,
  formatCompanyPhone,
  normalizeCompanyPhone,
} from "@/lib/company-contacts";
import { prisma } from "@/lib/prisma";
import { patchSettingsManagement } from "@/lib/services/settings-management.service";

if (!process.env.TEST_DATABASE_URL || process.env.DATABASE_URL !== process.env.TEST_DATABASE_URL)
  throw new Error("Company contacts integration requires TEST_DATABASE_URL");

async function main() {
  assert.equal(normalizeCompanyPhone("8 (708) 575-08-81"), "+77085750881");
  assert.equal(normalizeCompanyPhone("+7 776 002 7555"), "+77760027555");
  assert.equal(formatCompanyPhone("+77760027555"), "+7 776 002 7555");
  assert.deepEqual(companyPhoneValues(), ["+77085750881", "+77760027555"]);
  assert.deepEqual(companyDisplayPhones(), ["+7 708 575 0881", "+7 776 002 7555"]);

  const original = await prisma.companySettings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
    select: { phone: true, secondaryPhone: true },
  });
  try {
    const result = await patchSettingsManagement({
      company: {
        phone: "+7 708 575 0881",
        secondaryPhone: "+7 776 002 7555",
      },
    });
    assert.equal(result.company.phone, "+77085750881");
    assert.equal(result.company.secondaryPhone, "+77760027555");
  } finally {
    await prisma.companySettings.update({ where: { id: 1 }, data: original });
  }

  const order: DocumentOrder = {
    id: 1,
    number: "ORD-CONTACTS",
    address: "Алматы",
    material: "Сосна",
    staircase: "Прямая",
    amount: 1_000_000,
    prepayment: 700_000,
    balance: 300_000,
    createdAt: new Date("2026-08-10T00:00:00.000Z"),
    client: { name: "Клиент", phone: "+77010000000", city: "Алматы" },
    company: {
      name: "ALTYN SAPA COMPANY",
      bin: "",
      legalAddress: "",
      actualAddress: "Алматы",
      phone: "+77085750881",
      secondaryPhone: "+77760027555",
      whatsapp: "",
      email: "",
      bankDetails: "",
      directorName: "",
      logoUrl: "",
    },
  };
  for (const [name, markup] of [
    ["commercial proposal", renderToStaticMarkup(<CommercialProposal order={order}/>)],
    ["act", renderToStaticMarkup(<WorkCompletionAct order={order}/>)],
    ["invoice", renderToStaticMarkup(<Invoice order={order}/>)],
  ] as const) {
    assert(markup.includes("+7 708 575 0881"), `${name} is missing primary phone`);
    assert(markup.includes("+7 776 002 7555"), `${name} is missing secondary phone`);
  }

  for (const file of [
    "app/api/clients/[id]/proposals/route.ts",
    "components/documents/CommercialProposal.tsx",
    "components/documents/DocumentBrand.tsx",
    "lib/contracts/docx.ts",
    "lib/services/proposal-pdf.service.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert(!/708\s*575\s*0?8\s*81|77085750881/.test(source), `${file} contains a company phone hardcode`);
  }
  const settingsUi = readFileSync("components/pages/SettingsPage.tsx", "utf8");
  assert(settingsUi.includes("Телефон 1") && settingsUi.includes("Телефон 2"), "Company Settings does not expose both phones");
  console.log("canonical company contacts, normalization, Settings and document coverage passed");
}

void main().finally(() => prisma.$disconnect());
