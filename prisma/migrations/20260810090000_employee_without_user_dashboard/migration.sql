ALTER TABLE "EmployeePayrollProfile"
ADD COLUMN "name" TEXT NOT NULL DEFAULT '',
ADD COLUMN "position" TEXT NOT NULL DEFAULT '',
ADD COLUMN "phone" TEXT,
ADD COLUMN "email" TEXT;

UPDATE "EmployeePayrollProfile" AS employee
SET
  "name" = account."name",
  "position" = account."role"::text,
  "phone" = account."phone",
  "email" = account."email"
FROM "User" AS account
WHERE employee."userId" = account."id";

INSERT INTO "EmployeePayrollProfile" (
  "userId",
  "name",
  "position",
  "phone",
  "email",
  "hiredAt",
  "payrollEnabled",
  "baseSalary",
  "defaultGuaranteedBonus",
  "active",
  "createdAt",
  "updatedAt"
)
SELECT
  account."id",
  account."name",
  account."role"::text,
  account."phone",
  account."email",
  account."createdAt",
  TRUE,
  0,
  20000,
  TRUE,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" AS account
WHERE account."active" = TRUE
  AND account."role" <> 'PARTNER'::"Role"
  AND NOT EXISTS (
    SELECT 1
    FROM "EmployeePayrollProfile" AS employee
    WHERE employee."userId" = account."id"
  );

ALTER TABLE "EmployeePayrollProfile"
DROP CONSTRAINT "EmployeePayrollProfile_userId_fkey";

ALTER TABLE "EmployeePayrollProfile"
ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "EmployeePayrollProfile"
ADD CONSTRAINT "EmployeePayrollProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
