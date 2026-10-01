import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { STAIR_CATALOG_REFERENCES } from "@/lib/design-catalog";
import { buildMeasurementDesignPrompt } from "@/lib/orders/design-brief";

const prompt = buildMeasurementDesignPrompt(
  {
    measurementId: 42,
    clientName: "Тестовый клиент",
    city: "Алматы",
    address: "ул. Абая, 10",
    designStyle: "Современный",
    designNotes: "Белая обшивка снизу",
  },
  [
    { type: "OBJECT_FRONT", fileName: "front.jpg" },
    { type: "OBJECT_SIDE", fileName: "side.jpg" },
    { type: "OBJECT_REAR", fileName: "rear.jpg" },
    { type: "DESIGN_REFERENCE", fileName: "reference.jpg" },
  ],
);

assert.match(prompt, /сохрани помещение, ракурс, лестничный проём/);
assert.match(prompt, /Не переноси помещение с фотографии-примера/);
assert.match(prompt, /Белая обшивка снизу/);
assert.match(prompt, /ALTYN SAPA™️/);
assert.match(prompt, /\+7 708 575 08 81/);
assert.match(prompt, /front\.jpg/);
assert.match(prompt, /reference\.jpg/);

const service = readFileSync("lib/services/measurement.service.ts", "utf8");
const workspace = readFileSync(
  "components/measurements/MeasurementDesignWorkflow.tsx",
  "utf8",
);
const catalog = readFileSync("lib/services/design-catalog.service.ts", "utf8");
const attachmentService = readFileSync("lib/services/attachment.service.ts", "utf8");
const clientUploadRoute = readFileSync("app/api/attachments/client-upload/route.ts", "utf8");
const catalogDownloadRoute = readFileSync("app/api/design-catalog/download/route.ts", "utf8");
const catalogPage = readFileSync("components/catalog/StairCatalogPage.tsx", "utf8");

for (const gate of [
  "OBJECT_PHOTOS_REQUIRED",
  "DESIGN_REFERENCE_REQUIRED",
  "DESIGN_PROMPT_REQUIRED",
  "DESIGN_RESULT_REQUIRED",
  "DESIGN_NOT_SHOWN",
])
  assert(service.includes(gate), `missing completion gate ${gate}`);
for (const type of [
  "OBJECT_FRONT",
  "OBJECT_SIDE",
  "OBJECT_REAR",
  "DESIGN_REFERENCE",
  "DESIGN_RESULT",
])
  assert(workspace.includes(type), `missing UI step ${type}`);
assert(workspace.includes("capture=\"environment\""));
assert(workspace.includes("Скопировать готовый промпт"));
assert(workspace.includes("Подтвердить: показал клиенту"));
assert(catalog.includes("CATALOG_REFERENCE_SELECTED"));
assert(catalog.includes('purpose: { in: CATALOG_PURPOSES }'));
assert(catalogDownloadRoute.includes('requirePermission("measurements")'));
assert(catalogDownloadRoute.includes("application/zip"));
assert(catalogPage.includes("Скачать весь каталог ZIP"));
assert(catalogPage.includes("Открыть крупно"));
assert(STAIR_CATALOG_REFERENCES.filter((item) => item.isReal).length >= 3);
for (const item of STAIR_CATALOG_REFERENCES) {
  assert(
    existsSync(path.join("public", "catalog", "stairs", item.fileName)),
    `missing curated catalog file ${item.fileName}`,
  );
}
assert(attachmentService.includes('"video/mp4"'));
assert(attachmentService.includes('"video/quicktime"'));
assert(attachmentService.includes('bytes.subarray(4, 8).toString("ascii") === "ftyp"'));
assert(clientUploadRoute.includes("handleUpload"));
assert(clientUploadRoute.includes("registerClientUploadedVideo"));

console.log("measurement 3D workflow, prompt and catalog contracts passed");
