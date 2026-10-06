import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Role } from "@prisma/client";

import {
  ALMATY_MEASURER_TERRITORY,
  ASTANA_MEASURER_TERRITORY,
  measurerTerritoryMatch,
  MEASURER_TERRITORY_TEMPLATES,
  normalizeTerritoryCity,
  SEMEY_MEASURER_TERRITORY,
  SHYMKENT_MEASURER_TERRITORY,
} from "@/lib/measurements/measurer-territory";
import {
  isMeasurementLeader,
  MEASUREMENT_PERFORMER_ROLES,
  measurementMeasurerWhatsAppText,
  measurementScope,
  measurementWhatsAppText,
} from "@/lib/services/measurement.service";

assert.equal(isMeasurementLeader(Role.DIRECTOR), true);
assert.equal(isMeasurementLeader(Role.OPERATIONS_DIRECTOR), true);
assert.equal(isMeasurementLeader(Role.MANAGER), false);
assert.deepEqual(measurementScope({ userId: 7, role: Role.DIRECTOR, name: "Основатель" }), {});
assert.deepEqual(measurementScope({ userId: 8, role: Role.OPERATIONS_DIRECTOR, name: "Директор" }), {});
assert.deepEqual(measurementScope({ userId: 9, role: Role.MEASURER, name: "Замерщик" }), {
  OR: [
    { measurerUserId: 9 },
    { measurerUserId: null, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
  ],
});
assert(MEASUREMENT_PERFORMER_ROLES.includes(Role.DIRECTOR));
assert(MEASUREMENT_PERFORMER_ROLES.includes(Role.OPERATIONS_DIRECTOR));
assert(MEASUREMENT_PERFORMER_ROLES.includes(Role.MEASURER));

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
assert.match(group, /Ответственный за замер: Еркебулан/);
assert.match(group, /Телефон ответственного: \+77020000000/);

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
const measurementRoute = readFileSync("app/api/measurements/[id]/route.ts", "utf8");
const measurementsRoute = readFileSync("app/api/measurements/route.ts", "utf8");
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
assert(service.includes("CLAIMED_BY_LEADER"));
assert(service.includes("CLAIMED_BY_MEASURER"));
assert(measurementRoute.includes('action === "claim"'));
assert(measurementsRoute.includes("isMeasurementPerformer(actor.role)"));
assert(workspace.includes("Взять свободный замер себе"));
assert(workspace.includes("не выбран — можно взять себе"));
assert(workspace.includes("Заявка клиента (без заказа)"));
assert(workspace.includes("Провести назначенный замер"));
assert(workspace.includes("Новый замер без заявки"));
assert(workspace.includes("{measurer && <button") && !workspace.includes("{measurementPerformer && <button type=\"button\" onClick={() => setCreateOpen"));
assert(workspace.includes('сначала создайте его в разделе <Link href="/clients"'));

console.log("measurer territory, leader access, WhatsApp and assignment contracts passed");
