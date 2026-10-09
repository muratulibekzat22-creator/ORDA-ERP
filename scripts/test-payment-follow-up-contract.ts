import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { assertPaymentFollowUpInput, paymentPromisesFitBalance } from "@/lib/services/payment-follow-up.service";

const read = (path: string) => readFileSync(path, "utf8");

const now = new Date("2026-10-02T08:00:00.000Z");
assert.throws(() => assertPaymentFollowUpInput(100000, new Date("2026-10-02T07:59:59.000Z"), now), /INVALID_PAYMENT_FOLLOW_UP_DATE/);
assert.throws(() => assertPaymentFollowUpInput(0, new Date("2026-10-03T08:00:00.000Z"), now), /INVALID_PAYMENT_FOLLOW_UP_AMOUNT/);
assert.doesNotThrow(() => assertPaymentFollowUpInput(100000, new Date("2026-10-02T08:01:00.000Z"), now));
assert.equal(paymentPromisesFitBalance("0.10", "0.20", "0.30"), true, "exact decimal boundary must fit");
assert.equal(paymentPromisesFitBalance("0.10", "0.21", "0.30"), false, "one tiyn above balance must be rejected");

const service = read("lib/services/payment-follow-up.service.ts");
const existingBranch = service.indexOf("if (existing)");
const existingAuthorization = service.indexOf("existing.orderId !== input.orderId", existingBranch);
const hashCheck = service.indexOf("compareRequestHash", existingBranch);
const dateValidation = service.indexOf("assertPaymentFollowUpInput(input.amount", existingBranch);
assert(existingBranch >= 0 && existingAuthorization > existingBranch && hashCheck > existingAuthorization && dateValidation > hashCheck, "idempotent replay must authorize first and validate a date only for a new task");
assert.match(service, /pg_advisory_xact_lock/);
assert.match(service, /activePromises[\s\S]*PAYMENT_FOLLOW_UPS_EXCEED_BALANCE/);
assert.match(service, /PAYMENT_FOLLOW_UP_CANCEL_REASON_REQUIRED/);
assert.match(service, /input\.actor\.role === Role\.MANAGER && task\.dueAt <= now/);

const orderService = read("lib/services/order.service.ts");
assert(orderService.indexOf("if (existingEvent)") < orderService.indexOf("assertPaymentFollowUpInput(data.paymentPromiseAmount"));
const orderRoute = read("app/api/orders/route.ts");
assert.doesNotMatch(orderRoute, /paymentPromiseAt\.getTime\(\)\s*</, "the route must not reject a delayed idempotent replay before the service sees its key");

const paymentService = read("lib/services/payment.service.ts");
assert.doesNotMatch(paymentService, /completeCoveredPaymentFollowUps|AUTO_COMPLETED_BY_PAYMENT/);
const mandatory = read("lib/services/mandatory-task.service.ts");
assert.match(mandatory, /PAYMENT_FOLLOW_UP_COMPLETION_TOO_LATE/);
assert.match(mandatory, /24 \* 60 \* 60_000/);

console.log("payment follow-up contract checks passed");
