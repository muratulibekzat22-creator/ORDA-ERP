import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { buildMeasurementSheetPdf } from "@/lib/services/measurement-sheet-pdf.service";
import { measurementQuoteAmounts, parseMeasurementDraft } from "@/lib/services/measurement.service";

const root = process.cwd();
const source = (file: string) => readFile(path.join(root, file), "utf8");

async function main() {
  const [schema, service, measurementRoute, workspace, sheetRoute, documents, partnerRoute, partnerMeasurementRoute, partnerPage, sheetPdf, convertRoute, migration, proxy] = await Promise.all([
    source("prisma/schema.prisma"), source("lib/services/measurement.service.ts"), source("app/api/measurements/[id]/route.ts"),
    source("components/measurements/MeasurementWorkspace.tsx"), source("app/api/measurements/[id]/sheet/route.ts"),
    source("lib/services/document.service.ts"), source("app/api/partner/dashboard/route.ts"), source("app/api/partner/measurements/route.ts"), source("app/partner/page.tsx"), source("lib/services/measurement-sheet-pdf.service.ts"),
    source("app/api/proposals/[id]/convert/route.ts"), source("prisma/migrations/20261006130000_measurement_final_quote_and_sheet/migration.sql"), source("proxy.ts"),
  ]);
  for (const field of ["sourceProposalId", "finalProposalId", "quoteBasePrice", "quoteDiscount", "quoteFinalPrice", "quoteConfirmedAt"])
    assert(schema.includes(field) && migration.includes(field), `missing persisted field ${field}`);
  assert(service.includes("validateCommercialQuote") && service.includes("createFinalMeasurementProposal"), "measurement quote/final proposal service missing");
  assert(service.includes("QUOTE_CONFIRMATION_REQUIRED") && service.includes("COMMERCIAL_QUOTE_SAVED"), "quote guard/audit missing");
  assert(!service.includes('throw new MeasurementError("SHEET_PHOTO_REQUIRED")'), "generated measurement sheet must not require a separate paper sheet photo");
  assert(measurementRoute.includes('action === "save-quote"') && measurementRoute.includes('action === "link-order"'), "measurement API actions missing");
  assert(workspace.includes("КП менеджера и окончательная цена") && workspace.includes("Скидка на объекте") && workspace.includes("Окончательная сумма озвучена"), "measurer commercial UI missing");
  assert(sheetRoute.includes('requirePermission("documents")') && sheetRoute.includes("getGeneratedMeasurementSheetData"), "generated sheet lacks document authorization");
  assert(sheetRoute.includes("redactCommercial") && sheetRoute.includes("Role.PARTNER"), "partner PDF does not redact client commercial values");
  assert(documents.includes("GENERATED_MEASUREMENT_SHEET") && documents.includes("actor.role === Role.MEASURER"), "generated sheet listing/scope missing");
  assert(convertRoute.includes("ORDER_AUTO_LINKED") && convertRoute.includes("measurement.updateMany"), "lead measurement is not auto-linked to converted order");
  assert(partnerPage.includes('fetch("/api/partner/dashboard"') && !partnerPage.includes("/api/orders?page="), "partner page must use only dedicated safe endpoint");
  assert(partnerPage.includes('useState<Language>("uz")') && partnerPage.includes("O‘zbekcha") && partnerPage.includes("Shu buyurtmaga o‘lchov qo‘shish"), "partner cabinet is not Uzbek-first");
  assert(partnerPage.includes("Новый контрольный замер будет сохранён только в заказе {number}") && partnerPage.includes("Новый заказ или отдельная заявка здесь не создаются"), "partner measurement ownership is not clear in the UI");
  assert(partnerPage.includes('fetch("/api/partner/measurements"') && partnerPage.includes("controlSheet"), "partner control measurement UI missing");
  assert(partnerMeasurementRoute.includes('requirePermission("partners")') && partnerMeasurementRoute.includes("Role.PARTNER") && partnerMeasurementRoute.includes("readIdempotencyKey"), "partner control measurement API lacks role or idempotency guard");
  assert(service.includes("createPartnerControlMeasurement") && service.includes("PARTNER_CONTROL_MEASUREMENT_CREATED") && service.includes("controlMeasurementCompletedAt"), "partner control measurement persistence/audit missing");
  assert(service.includes("partnerId: partner.id") && service.includes('lifecycle: { not: "CANCELLED" }'), "partner control measurement is not scoped to assigned active orders");
  assert(sheetRoute.includes('url.searchParams.get("lang") === "uz"') && sheetPdf.includes("O‘LCHOV VARAQASI"), "Uzbek measurement sheet missing");
  assert(proxy.includes('PARTNER: ["partner"]') && proxy.includes('firstSegment !== "partner"'), "partner can navigate to general ERP pages");
  const partnerOrderProjection = partnerRoute.slice(partnerRoute.indexOf("orders: orders.map"), partnerRoute.indexOf("activeOrders:"));
  for (const secret of ["amount: order.amount", "prepayment: order.prepayment", "balance: order.balance", "companyProfit", "calculations:"])
    assert(!partnerOrderProjection.includes(secret), `partner projection exposes ${secret}`);
  for (const required of ["partnerPrice", "partnerPaid", "partnerBalance", "measurements", "sheetHref"])
    assert(partnerOrderProjection.includes(required), `partner projection misses ${required}`);
  assert.deepEqual(measurementQuoteAmounts(2_900_000, 100_000), { basePrice: 2_900_000, discount: 100_000, finalPrice: 2_800_000 });
  assert.deepEqual(measurementQuoteAmounts(1_350_000, 50_000), { basePrice: 1_350_000, discount: 50_000, finalPrice: 1_300_000 });
  assert.deepEqual(measurementQuoteAmounts(900_000, 0), { basePrice: 900_000, discount: 0, finalPrice: 900_000 });
  assert.throws(() => measurementQuoteAmounts(1_000_000, 1_000_000), /INVALID_QUOTE/);
  const controlDraft = parseMeasurementDraft({
    floorHeight: 3000, staircaseWidth: 1100, stepsCount: 15, sameSize: true,
    stepLength: 1000, stepWidth: 300, stepHeight: 40, riserHeight: 180,
    winderCount: 2, platformsCount: 1, platforms: [{ length: 1200, width: 1000 }],
    railingLength: 5.4, objectNotes: "Nazorat o‘lchovi",
  });
  assert.equal(controlDraft.floorHeight, 3000);
  assert.equal(controlDraft.staircaseWidth, 1100);
  assert.equal(controlDraft.platforms?.length, 1);
  assert.equal(parseMeasurementDraft({ ...controlDraft, railingLength: 0 }).railingLength, 0, "control measurement must allow an order without railing");

  const pdf = await buildMeasurementSheetPdf({
    id: 7001, completedAt: new Date().toISOString(), visitDate: new Date().toISOString(), city: "Алматы", address: "Тестовый объект",
    client: { name: "Тестовый клиент", phone: "+7 700 000 00 00", city: "Алматы" }, order: { number: "TEST-ORDER", status: "Оформлен" }, measurerUser: { name: "Тестовый замерщик" },
    stepsCount: 15, sameSize: true, stepLength: 1000, stepWidth: 300, stepHeight: 40, riserHeight: 180, winderCount: 2, platformsCount: 1, railingLength: 5.4,
    quoteMaterial: "Карагач", quoteBasePrice: 2_900_000, quoteDiscount: 100_000, quoteFinalPrice: 2_800_000, finalProposal: { number: "100-V2" },
  });
  assert.equal(pdf.subarray(0, 5).toString("ascii"), "%PDF-", "measurement sheet PDF is invalid");
  assert(pdf.byteLength > 5_000, "measurement sheet PDF is unexpectedly empty");
  const uzPdf = await buildMeasurementSheetPdf({
    language: "uz", redactCommercial: true, id: 7002, completedAt: new Date().toISOString(), visitDate: new Date().toISOString(),
    city: "Olmaota", address: "Test obyekt", client: { name: "Test mijoz", phone: "+7 700 000 00 00", city: "Olmaota" },
    order: { number: "TEST-UZ", status: "Ishda" }, measurerUser: { name: "Test hamkor" }, floorHeight: 3000,
    staircaseWidth: 1100, stepsCount: 15, sameSize: true, stepLength: 1000, stepWidth: 300, stepHeight: 40,
    riserHeight: 180, winderCount: 2, platformsCount: 1, railingLength: 5.4,
  });
  assert.equal(uzPdf.subarray(0, 5).toString("ascii"), "%PDF-", "Uzbek measurement sheet PDF is invalid");
  assert(uzPdf.byteLength > 5_000, "Uzbek measurement sheet PDF is unexpectedly empty");
  const db = new PGlite();
  await db.exec('CREATE TABLE "CommercialProposal" ("id" SERIAL PRIMARY KEY); CREATE TABLE "Measurement" ("id" SERIAL PRIMARY KEY);');
  await db.exec(migration);
  const columns = await db.query<{ column_name: string }>('SELECT column_name FROM information_schema.columns WHERE table_name = \'Measurement\'');
  const columnNames = new Set(columns.rows.map((row) => row.column_name));
  for (const field of ["sourceProposalId", "finalProposalId", "quoteBasePrice", "quoteDiscount", "quoteFinalPrice", "quoteConfirmedAt"])
    assert(columnNames.has(field), `migration did not create ${field}`);
  await db.exec(`
    INSERT INTO "CommercialProposal" ("id") VALUES (101), (102), (103);
    INSERT INTO "Measurement" ("sourceProposalId", "quoteMaterial", "quoteBasePrice", "quoteDiscount", "quoteFinalPrice", "quoteConfirmedAt") VALUES
      (101, 'Карагач', 2900000, 100000, 2800000, NOW()),
      (102, 'Дуб ламель', 1350000, 50000, 1300000, NOW()),
      (103, 'Сосна', 900000, 0, 900000, NOW());
  `);
  const temporary = await db.query<{ valid: boolean }>('SELECT bool_and("quoteFinalPrice" = "quoteBasePrice" - "quoteDiscount") AS valid FROM "Measurement"');
  assert.equal(temporary.rows[0]?.valid, true, "temporary measurement scenarios have inconsistent totals");
  await db.exec('DELETE FROM "Measurement"; DELETE FROM "CommercialProposal";');
  const cleaned = await db.query<{ count: string }>('SELECT count(*)::text AS count FROM "Measurement"');
  assert.equal(cleaned.rows[0]?.count, "0", "temporary measurement scenarios were not removed");
  await db.close();
  console.log("measurement commercial, generated sheet and partner boundary contract passed");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
