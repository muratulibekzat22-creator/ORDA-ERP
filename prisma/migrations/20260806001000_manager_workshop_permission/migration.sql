INSERT INTO "RolePermission" ("role", "permission", "createdAt", "updatedAt")
VALUES ('MANAGER', 'partners', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("role", "permission") DO NOTHING;
