import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  calculateStair,
  STAIR_RATES,
} from "../lib/calculator/stair-calculation";
import { PROPOSAL_VALIDITY_DAYS } from "../lib/proposals/presentation";
import { buildProposalPdf } from "../lib/services/proposal-pdf.service";

async function main() {
  const createdAt = new Date("2026-08-10T09:00:00.000Z");
  const common = {
    regularSteps: 15,
    platformEquivalents: [2],
    installationRequired: true,
    deliveryRequired: true,
  };
  const warranties: Record<string, string> = {
    Сосна: "6 месяцев",
    Карагач: "1 год",
    "Дуб ламель": "5 лет",
  };
  const variants = (["Сосна", "Карагач", "Дуб ламель"] as const).map(
    (material) => {
      const calculation = calculateStair({ material, ...common }, STAIR_RATES);
      return {
        material,
        total: calculation.clientPrice,
        executionTerm: "40-50 календарных дней",
        warranty: warranties[material],
      };
    },
  );
  const pdf = await buildProposalPdf({
    number: "КП-000247",
    createdAt: createdAt.toISOString(),
    validUntil: new Date(
      createdAt.getTime() + PROPOSAL_VALIDITY_DAYS * 86_400_000,
    ).toISOString(),
    company: {
      name: "ALTYN SAPA COMPANY",
      phone: "+7 708 575 0881",
      whatsapp: "+7 708 575 0881",
    },
    client: {
      name: "Александр",
      phone: "+7 777 123 45 67",
      city: "Алматы",
    },
    variants,
  });
  const outputDirectory = path.join(process.cwd(), "output", "pdf");
  await mkdir(outputDirectory, { recursive: true });
  const output = path.join(
    outputDirectory,
    "commercial-proposal-altyn-sapa-preview.pdf",
  );
  await writeFile(output, pdf);
  console.log(output);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
