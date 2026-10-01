import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  measurerTerritoryMatch,
  normalizeTerritoryCity,
  SEMEY_MEASURER_TERRITORY,
} from "@/lib/measurements/measurer-territory";
import { measurementMeasurerWhatsAppText, measurementWhatsAppText } from "@/lib/services/measurement.service";

const profile = {
  homeCity: "Семей",
  maxTravelMinutes: 240,
  serviceAreas: SEMEY_MEASURER_TERRITORY,
};

assert.equal(normalizeTerritoryCity("Семипалатинск"), "семей");
assert.equal(normalizeTerritoryCity("Өскемен"), "усть-каменогорск");
assert.equal(measurerTerritoryMatch(profile, "Семей").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(profile, "Усть Каменогорск").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(profile, "Павлодар").status, "APPROVAL_REQUIRED");
assert.equal(measurerTerritoryMatch(profile, "Аягоз").status, "APPROVAL_REQUIRED");
assert.equal(measurerTerritoryMatch(profile, "Экибастуз").status, "APPROVAL_REQUIRED");
assert.equal(measurerTerritoryMatch(profile, "Зайсан").status, "APPROVAL_REQUIRED");
assert.equal(measurerTerritoryMatch(profile, "Алматы").status, "OUTSIDE_AREA");

const group = measurementWhatsAppText({
  clientName: "Клиент",
  clientPhone: "+77010000000",
  visitDate: new Date("2026-10-05T06:00:00.000Z"),
  city: "Семей",
  address: "ул. Абая, 1",
  measurerName: "Еркебулан",
  measurerPhone: "+77020000000",
  managerName: "Менеджер",
});
assert.match(group, /Замерщик: Еркебулан/);
assert.match(group, /Телефон замерщика: \+77020000000/);

const direct = measurementMeasurerWhatsAppText({
  measurerName: "Еркебулан",
  clientName: "Клиент",
  clientPhone: "+77010000000",
  visitDate: new Date("2026-10-05T06:00:00.000Z"),
  city: "Семей",
  address: "ул. Абая, 1",
  managerName: "Менеджер",
});
assert.match(direct, /Вам назначен новый замер/);
assert.match(direct, /3 ракурса/);
assert.match(direct, /передайте результат менеджеру/);

const service = readFileSync("lib/services/measurement.service.ts", "utf8");
const leadPanel = readFileSync("components/measurements/LeadMeasurementPanel.tsx", "utf8");
const workspace = readFileSync("components/measurements/MeasurementWorkspace.tsx", "utf8");
const employeePage = readFileSync("components/pages/EmployeesPage.tsx", "utf8");
for (const marker of ["MEASURER_OUTSIDE_SERVICE_AREA", "MEASURER_TRAVEL_APPROVAL_REQUIRED"])
  assert(service.includes(marker), `missing server territory gate ${marker}`);
for (const source of [leadPanel, workspace]) {
  assert(source.includes("travelApproved"));
  assert(source.includes("whatsappMeasurerText"));
  assert(source.includes("measurerTerritoryMatch"));
}
assert(employeePage.includes("Шаблон для Семея"));
assert(employeePage.includes("Территория замерщика"));

console.log("measurer territory, WhatsApp and assignment contracts passed");
