-- Managers and marketers need the personal payroll workspace in every active tenant.
INSERT INTO "RolePermission" ("companyId", "role", "permission", "createdAt", "updatedAt")
SELECT company.id, access.role, 'payroll'::"Permission", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Company" company
CROSS JOIN (VALUES ('MANAGER'::"Role"), ('MARKETER'::"Role")) AS access(role)
WHERE company.active = TRUE
ON CONFLICT ("companyId", "role", "permission") DO NOTHING;

-- Historical records remain untouched. New manager order bonuses are protected
-- against concurrent double entry in addition to the service-level validation.
DO $$
DECLARE
  existing_cutoff INTEGER;
BEGIN
  IF to_regclass('"PayrollAccrual_future_order_bonus_key"') IS NULL THEN
    SELECT COALESCE(MAX(id), 0) INTO existing_cutoff FROM "PayrollAccrual";
    EXECUTE format(
      'CREATE UNIQUE INDEX "PayrollAccrual_future_order_bonus_key" '
      'ON "PayrollAccrual" ("orderId") '
      'WHERE "orderId" IS NOT NULL '
      'AND "type" = ''ORDER_BONUS''::"PayrollAccrualType" '
      'AND "direction" = ''INCREASE''::"PayrollDirection" '
      'AND "reversalOfId" IS NULL AND id > %s',
      existing_cutoff
    );
  END IF;
END $$;
