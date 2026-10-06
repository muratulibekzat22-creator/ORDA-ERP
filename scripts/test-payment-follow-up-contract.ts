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
assert.match(
  service,
  /order\.responsibleType === OrderResponsibleType\.EMPLOYEE[\s\S]*order\.managerUserId === actor\.userId/,
  "manager follow-up access must use the current normalized order responsibility",
);
assert.match(
  service,
  /order\.responsibleType !== OrderResponsibleType\.EMPLOYEE \|\| !order\.managerUserId/,
  "a COMPANY order must not create a follow-up assigned to a stale employee",
);

const orderService = read("lib/services/order.service.ts");
assert(orderService.indexOf("if (existingEvent)") < orderService.indexOf("assertPaymentFollowUpInput(data.paymentPromiseAmount"));
const orderRoute = read("app/api/orders/route.ts");
assert.doesNotMatch(orderRoute, /paymentPromiseAt\.getTime\(\)\s*</, "the route must not reject a delayed idempotent replay before the service sees its key");

const paymentService = read("lib/services/payment.service.ts");
assert.doesNotMatch(paymentService, /completeCoveredPaymentFollowUps|AUTO_COMPLETED_BY_PAYMENT/);
assert.match(paymentService, /await input\.transactionAction\?\./, "the task result must participate in the finance transaction");
const mandatory = read("lib/services/mandatory-task.service.ts");
assert.match(mandatory, /PAYMENT_FOLLOW_UP_COMPLETION_TOO_LATE/);
assert.match(mandatory, /24 \* 60 \* 60_000/);
assert.doesNotMatch(mandatory, /controlKey: null, acknowledgedAt/, "generated payment and daily tasks must still request a result");
const resultRoute = read("app/api/calendar/[id]/result/route.ts");
assert.match(resultRoute, /calendar-payment-result:/, "task-confirmed payments need a stable idempotency key");
assert.match(resultRoute, /createPayment\(/, "a confirmed payment must be posted to order finance");
assert.match(resultRoute, /transactionAction:[\s\S]*completeMandatoryTaskResultInTransaction/, "payment and mandatory task completion must commit atomically");
assert.match(resultRoute, /Укажите точную сумму и способ полученной оплаты/);
const mandatoryGate = read("components/tasks/MandatoryTaskGate.tsx");
assert.match(mandatoryGate, /Подтвердить оплату и закрыть задачу/);
assert.match(mandatoryGate, /автоматически попадёт в заказ и финансы/);

console.log("payment follow-up contract checks passed");
