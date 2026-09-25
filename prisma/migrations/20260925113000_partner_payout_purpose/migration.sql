CREATE TYPE "PartnerPayoutPurpose" AS ENUM ('SUPPORT', 'ADVANCE', 'FINAL_PAYMENT', 'OTHER');

ALTER TABLE "Payment"
ADD COLUMN "partnerPayoutPurpose" "PartnerPayoutPurpose";

CREATE INDEX "Payment_partnerPayoutPurpose_operationDate_idx"
ON "Payment"("partnerPayoutPurpose", "operationDate");
