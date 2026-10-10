import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildMeasurementSheetPdf } from "@/lib/documents/measurement-sheet-pdf";

async function main() {
  const output = path.join(process.cwd(), "output", "pdf");
  await mkdir(output, { recursive: true });
  const bytes = await buildMeasurementSheetPdf({
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
    individualSteps: Array.from({ length: 15 }, (_, index) => ({ length: 900 + index, width: 300, height: 40 })),
    riserHeight: 180,
    winderCount: 2,
    winders: [{ length: 920, width: 310, comment: "левая" }, { length: 930, width: 320, comment: "правая" }],
    platformsCount: 1,
    platforms: [{ length: 1100, width: 1100 }],
    railingLength: 5.4,
    railingComment: "Ограждение по внешней стороне",
    objectNotes: "Проверить чистовой пол перед запуском в производство",
    comment: "Размеры перепроверены",
    designStyle: "Современный",
    designNotes: "Светлое дерево, чёрные стойки",
  });
  const file = path.join(output, "ORDA-control-measurement-sheet-preview.pdf");
  await writeFile(file, bytes);
  console.log(file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
