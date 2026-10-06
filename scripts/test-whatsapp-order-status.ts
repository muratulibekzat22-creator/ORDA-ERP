import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { PartnerBusinessStatus } from "@prisma/client";

import {
  normalizeWhatsappOrderLookup,
  presentWhatsappOrderStatus,
} from "@/lib/integrations/whatsapp-order-status";
import { parseWhatsappMeasurementIntake } from "@/lib/integrations/whatsapp-measurement-intake";
import { buildWhatsappStairPriceEstimate } from "@/lib/integrations/whatsapp-stair-pricing";

const normalizeToken = (value: string) => createHash("sha256").update(value).digest("hex");
assert.equal(normalizeToken("integration-token"), normalizeToken("integration-token"));
assert.notEqual(normalizeToken("integration-token"), normalizeToken("another-token"));

assert.deepEqual(normalizeWhatsappOrderLookup({ lookupType: "phone", value: "8 771 254 64 64" }), {
  lookupType: "phone",
  value: "+77712546464",
});
assert.deepEqual(
  normalizeWhatsappOrderLookup({ lookupType: "contract", value: "Договор № DOG-000042" }),
  { lookupType: "contract", value: "DOG-000042" },
);
assert.equal(normalizeWhatsappOrderLookup({ lookupType: "phone", value: "123" }), null);

const baseOrder = {
  number: "ORD-42",
  lifecycle: "IN_PRODUCTION" as const,
  partnerPlannedReadyAt: null,
  productionDeadline: null,
  promisedAt: null,
  updatedAt: new Date("2026-10-02T10:00:00.000Z"),
  partner: {
    name: "Configured partner",
    phone: "+77770000000",
    secondaryPhone: null,
    active: true,
    archived: false,
    businessStatus: PartnerBusinessStatus.ACTIVE,
  },
  productions: [{ stage: "FRAME", percent: 40 }],
  documents: [{ number: "DOG-000042" }],
};

const activeResult = presentWhatsappOrderStatus(baseOrder);
assert.deepEqual(activeResult.responsible, {
  name: "Configured partner",
  phone: "+77770000000",
});
assert.equal("clientName" in activeResult, false);
assert.equal("amount" in activeResult, false);
assert.equal("address" in activeResult, false);

const archivedResult = presentWhatsappOrderStatus({
  ...baseOrder,
  partner: { ...baseOrder.partner, archived: true },
});
assert.equal(archivedResult.responsible, null);

const cancelledResult = presentWhatsappOrderStatus({
  ...baseOrder,
  lifecycle: "CANCELLED",
});
assert.equal(cancelledResult.userStatus, "CANCELLED");

const measurement = parseWhatsappMeasurementIntake({
  event: "whatsapp_measurement_intake",
  handoffId: "handoff-12345678",
  applicationId: "application-12345678",
  customer: {
    name: "Тестовый клиент",
    city: "Кызылорда",
    whatsappE164: "8 708 912 50 48",
    callbackPhoneE164: null,
    language: "ru",
  },
  summary: "Нужен замер",
  fields: {
    stairs_step_count: 18,
    stairs_landing_count: 1,
    stairs_estimate_material: "pine",
    stairs_estimate_min: 1_235_000,
    stairs_estimate_max: 1_300_000,
    stairs_estimate_basis: "steps_only",
    stairs_measurement_time: "завтра после 15:00",
    untrusted_extra: "must be ignored",
  },
});
assert.ok(measurement);
assert.equal(measurement.customer.whatsappE164, "+77089125048");
assert.equal(measurement.fields.stairs_step_count, 18);
assert.equal(measurement.fields.stairs_estimate_min, 1_235_000);
assert.equal("untrusted_extra" in measurement.fields, false);
assert.equal(parseWhatsappMeasurementIntake({ ...measurement, event: "different" }), null);

const priceEstimate = buildWhatsappStairPriceEstimate(
  { regularSteps: 17, landingCount: 1, material: "pine" },
  [{
    code: "PINE_STEP",
    uiName: "Сосна",
    kind: "STAIR_MATERIAL",
    unit: "экв. ступень",
    salePrice: 65_000,
    internalPrice: 45_000,
    managerMinimumPrice: 0,
    defaultQuantity: 0,
    manualPriceAllowed: false,
    active: true,
    sortOrder: 10,
  }],
);
assert.equal(priceEstimate.variants[0]?.equivalentStepsMin, 19);
assert.equal(priceEstimate.variants[0]?.equivalentStepsMax, 20);
assert.equal(priceEstimate.variants[0]?.priceMin, 1_235_000);
assert.equal(priceEstimate.variants[0]?.priceMax, 1_300_000);
assert.equal(priceEstimate.basis, "steps_only");

console.log("WhatsApp order-status and measurement-intake integration tests passed");
