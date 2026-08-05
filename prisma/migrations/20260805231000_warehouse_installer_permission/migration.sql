INSERT INTO "RolePermission" ("role", "permission", "createdAt", "updatedAt")
VALUES ('INSTALLER', 'warehouse', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO UPDATE SET "updatedAt" = CURRENT_TIMESTAMP;
