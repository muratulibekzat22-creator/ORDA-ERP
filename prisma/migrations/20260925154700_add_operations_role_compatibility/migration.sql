-- Preserve legacy operational-access rows while keeping the temporary
-- operations workspace disabled in this simplified release.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'OPERATIONS_DIRECTOR';
ALTER TYPE "Permission" ADD VALUE IF NOT EXISTS 'operations';
CREATE SEQUENCE IF NOT EXISTS "employee_code_ops_seq"
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
