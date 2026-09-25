-- Link legacy real orders and clients to the active manager account only when
-- the normalized display name has one unambiguous match inside the company.
WITH candidates AS (
  SELECT o."id" AS "orderId", MIN(u."id") AS "managerUserId"
  FROM "Order" o
  JOIN "User" u
    ON u."companyId" = o."companyId"
   AND u."active" = true
   AND u."role" IN ('DIRECTOR', 'MANAGER')
   AND lower(trim(u."name")) = lower(trim(o."manager"))
  WHERE o."managerUserId" IS NULL
  GROUP BY o."id"
  HAVING COUNT(*) = 1
)
UPDATE "Order" o
SET "managerUserId" = candidates."managerUserId"
FROM candidates
WHERE o."id" = candidates."orderId";

WITH candidates AS (
  SELECT c."id" AS "clientId", MIN(u."id") AS "managerUserId"
  FROM "Client" c
  JOIN "User" u
    ON u."companyId" = c."companyId"
   AND u."active" = true
   AND u."role" = 'MANAGER'
   AND lower(trim(u."name")) = lower(trim(c."manager"))
  WHERE c."managerUserId" IS NULL
  GROUP BY c."id"
  HAVING COUNT(*) = 1
)
UPDATE "Client" c
SET "managerUserId" = candidates."managerUserId"
FROM candidates
WHERE c."id" = candidates."clientId";
