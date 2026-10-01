import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ALMATY_MEASURER_TERRITORY,
  ASTANA_MEASURER_TERRITORY,
  measurerTerritoryMatch,
  MEASURER_TERRITORY_TEMPLATES,
  normalizeTerritoryCity,
  SEMEY_MEASURER_TERRITORY,
  SHYMKENT_MEASURER_TERRITORY,
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

const astanaProfile = { homeCity: "Астана", maxTravelMinutes: 240, serviceAreas: ASTANA_MEASURER_TERRITORY };
assert.equal(normalizeTerritoryCity("Нур-Султан"), "астана");
assert.equal(normalizeTerritoryCity("Көкшетау"), "кокшетау");
assert.equal(measurerTerritoryMatch(astanaProfile, "Темиртау").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(astanaProfile, "Қарағанды").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(astanaProfile, "Кокшетау").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(astanaProfile, "Петропавл").status, "APPROVAL_REQUIRED");
assert.equal(measurerTerritoryMatch(astanaProfile, "Аркалык").status, "APPROVAL_REQUIRED");

const shymkentProfile = { homeCity: "Шымкент", maxTravelMinutes: 240, serviceAreas: SHYMKENT_MEASURER_TERRITORY };
assert.equal(normalizeTerritoryCity("Түркістан"), "туркестан");
assert.equal(normalizeTerritoryCity("Қызылорда"), "кызылорда");
assert.equal(measurerTerritoryMatch(shymkentProfile, "Туркестан").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(shymkentProfile, "Тараз").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(shymkentProfile, "Кызылорда").status, "APPROVAL_REQUIRED");

const almatyProfile = { homeCity: "Алматы", maxTravelMinutes: 240, serviceAreas: ALMATY_MEASURER_TERRITORY };
assert.equal(normalizeTerritoryCity("Алма-Ата"), "алматы");
assert.equal(normalizeTerritoryCity("Капчагай"), "конаев");
assert.equal(measurerTerritoryMatch(almatyProfile, "Талдыкорган").status, "AVAILABLE");
assert.equal(measurerTerritoryMatch(almatyProfile, "Чу").status, "APPROVAL_REQUIRED");
assert.deepEqual(MEASURER_TERRITORY_TEMPLATES.map((template) => template.id), ["SEMEY", "ASTANA", "SHYMKENT", "ALMATY"]);
assert.deepEqual(MEASURER_TERRITORY_TEMPLATES.map((template) => template.label), ["Семей · восток", "Астана · центр и север", "Шымкент · юг", "Алматы · юго-восток"]);

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
assert(employeePage.includes("MEASURER_TERRITORY_TEMPLATES.map"));
assert(employeePage.includes("applyTerritoryTemplate"));
assert(employeePage.includes("Территория замерщика"));

console.log("measurer territory, WhatsApp and assignment contracts passed");
