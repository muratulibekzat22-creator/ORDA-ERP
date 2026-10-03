-- Keep the simplified operations release compatible with legacy accounts that
-- already use the MARKETER role. No marketing workspace or permissions are
-- enabled by this migration.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'MARKETER';
CREATE SEQUENCE IF NOT EXISTS "employee_code_mkt_seq"
  START WITH 1 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;
