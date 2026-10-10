-- Every internal employee works with one shared warehouse. External workshop
-- partners remain outside the warehouse workspace.
INSERT INTO "RolePermission" ("companyId", "role", "permission", "createdAt", "updatedAt")
SELECT
    company.id,
    roles.role_name::"Role",
    'warehouse'::"Permission",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Company" AS company
CROSS JOIN (
    VALUES
        ('DIRECTOR'),
        ('OPERATIONS_DIRECTOR'),
        ('MARKETER'),
        ('MANAGER'),
        ('ACCOUNTANT'),
        ('MEASURER'),
        ('DESIGNER'),
        ('PRODUCTION'),
        ('INSTALLER')
) AS roles(role_name)
ON CONFLICT ("companyId", "role", "permission") DO NOTHING;

-- Company finance is confidential: only the founder and operations director
-- retain the finance permission.
DELETE FROM "RolePermission"
WHERE "permission" = 'finance'::"Permission"
  AND "role" NOT IN ('DIRECTOR'::"Role", 'OPERATIONS_DIRECTOR'::"Role");

-- Make the common manual operations explicit instead of hiding them behind a
-- generic "Other" category.
INSERT INTO "FinanceCategory" (
    "companyId",
    "code",
    "name",
    "direction",
    "system",
    "active",
    "createdAt",
    "updatedAt"
)
SELECT
    company.id,
    category.code,
    category.name,
    category.direction,
    true,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Company" AS company
CROSS JOIN (
    VALUES
        ('ADDITIONAL_INCOME', 'Дополнительный доход', 'INCOME'),
        ('ADDITIONAL_EXPENSE', 'Дополнительный расход', 'EXPENSE'),
        ('OTHER_EXPENSE', 'Прочие расходы', 'EXPENSE')
) AS category(code, name, direction)
ON CONFLICT ("companyId", "direction", "code") DO UPDATE
SET
    "name" = EXCLUDED."name",
    "system" = true,
    "active" = true,
    "updatedAt" = CURRENT_TIMESTAMP;
