import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { buildMeasurementSheetPdf, MEASUREMENT_SHEET_TEMPLATE_VERSION } from "@/lib/documents/measurement-sheet-pdf";
import { countPdfPages } from "@/lib/documents/pdf-utils";

async function main() {
const pdf = await buildMeasurementSheetPdf({
  measurementId: 493,
  orderNumber: "ORDA-493",
  status: "COMPLETED",
  visitDate: "2026-10-10T06:00:00.000Z",
  completedAt: "2026-10-10T07:30:00.000Z",
  client: { name: "Контрольный заказчик", phone: "+7 777 123 45 67" },
  location: { city: "Алматы", address: "ул. Абая, 10" },
  measurerName: "Замерщик",
  managerName: "Менеджер",
  floorHeight: 3.2,
  staircaseWidth: 1.1,
  stepsCount: 15,
  sameSize: false,
  individualSteps: Array.from({ length: 15 }, (_, index) => ({
    length: 900 + index,
    width: 300,
    height: 40,
  })),
  riserHeight: 180,
  winderCount: 2,
  winders: [
    { length: 920, width: 310, comment: "левая" },
    { length: 930, width: 320, comment: "правая" },
  ],
  platformsCount: 1,
  platforms: [{ length: 1100, width: 1100 }],
  railingLength: 5.4,
  railingComment: "Ограждение по внешней стороне",
  objectNotes: "Проверить чистовой пол перед запуском в производство",
  comment: "Размеры перепроверены",
  designStyle: "Современный",
  designNotes: "Светлое дерево, чёрные стойки",
});

assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-");
assert(pdf.length > 10_000, "measurement sheet PDF is unexpectedly small");
assert(countPdfPages(pdf) >= 1, "measurement sheet PDF has no pages");
assert(pdf.toString("latin1").includes(MEASUREMENT_SHEET_TEMPLATE_VERSION));

const route = readFileSync("app/api/measurements/[id]/sheet/route.ts", "utf8");
const workspace = readFileSync("components/measurements/MeasurementWorkspace.tsx", "utf8");
const service = readFileSync("lib/services/measurement.service.ts", "utf8");
assert(route.includes('requirePermission("measurements")'));
assert(route.includes('"Cache-Control": "private, no-store"'));
assert(route.includes('"X-Content-Type-Options": "nosniff"'));
assert(workspace.includes("Сохранить и открыть контрольный лист") || workspace.includes("Контрольный лист"));
assert(workspace.includes("Высота помещения, м"));
assert(workspace.includes("Ширина лестницы, м"));
assert(service.includes("floorHeight: positive(body.floorHeight, true)"));
assert(service.includes("staircaseWidth: positive(body.staircaseWidth, true)"));

console.log("measurement sheet PDF, access and fast measurer form contracts passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
