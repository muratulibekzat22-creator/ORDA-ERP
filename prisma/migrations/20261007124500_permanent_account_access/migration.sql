-- One-time release reset for active employee accounts. Password hashes stay unchanged.
UPDATE "User"
SET
  "failedLoginAttempts" = 0,
  "lockedUntil" = NULL,
  "mustChangePassword" = false
WHERE "active" = true;

-- Operations directors now use permanent director access instead of an expiry gate.
UPDATE "User"
SET
  "temporaryAccess" = false,
  "accessExpiresAt" = NULL,
  "accessRevokedAt" = NULL,
  "revokedById" = NULL,
  "revokeReason" = NULL,
  "ordaProjectOperationsEnabled" = true,
  "companyOperationsEnabled" = true
WHERE "active" = true
  AND "role" = 'OPERATIONS_DIRECTOR';
