-- Normalize the remaining values introduced by the retired Demo schema so
-- both companies can be read by the approved shared application contract.
-- Business rows, immutable document versions, files, amounts and snapshots
-- remain unchanged.

-- Retain every Demo employee while mapping retired operational roles to the
-- nearest role supported by the shared production shell and RBAC policy.
UPDATE "User"
SET "role" = CASE "role"::text
  WHEN 'DRIVER' THEN 'INSTALLER'::"Role"
  WHEN 'PROCUREMENT' THEN 'PRODUCTION'::"Role"
  ELSE "role"
END
WHERE "companyId" = 2
  AND "role"::text IN ('DRIVER', 'PROCUREMENT');

-- Legacy payroll completion states map to the canonical period lifecycle.
UPDATE "PayrollPeriod"
SET "status" = CASE "status"::text
  WHEN 'PAID' THEN 'CLOSED'::"PayrollPeriodStatus"
  WHEN 'PARTIALLY_PAID' THEN 'REVIEW'::"PayrollPeriodStatus"
  ELSE "status"
END
WHERE "companyId" = 2
  AND "status"::text IN ('PAID', 'PARTIALLY_PAID');

-- These immutable Demo document classifications remain readable without
-- rewriting their order relation, version, snapshot, blob or checksum.
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'PREPAYMENT_CONFIRMATION';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'CLOSING_ACT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'WARRANTY';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'FINAL_PAYMENT_CONFIRMATION';

-- These roles and the `salaries` permission are not part of the approved
-- production RBAC contract. Current supported permissions remain untouched.
DELETE FROM "RolePermission"
WHERE "role"::text IN ('ADMIN', 'DRIVER', 'PROCUREMENT')
   OR "permission"::text = 'salaries';
