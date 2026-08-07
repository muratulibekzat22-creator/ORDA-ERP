INSERT INTO "RolePermission" ("role", "permission", "createdAt", "updatedAt")
VALUES
  ('DIRECTOR', 'payroll', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('ACCOUNTANT', 'payroll', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
