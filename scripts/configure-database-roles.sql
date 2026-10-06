\set ON_ERROR_STOP on
\if :{?runtime_password}
\else
  \echo 'runtime_password is required'
  \quit 3
\endif
\if :{?migration_password}
\else
  \echo 'migration_password is required'
  \quit 3
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orda_runtime') THEN
    CREATE ROLE orda_runtime LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 80;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orda_migrator') THEN
    CREATE ROLE orda_migrator LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 5;
  END IF;
END $$;

SELECT format('ALTER ROLE orda_runtime PASSWORD %L', :'runtime_password') \gexec
SELECT format('ALTER ROLE orda_migrator PASSWORD %L', :'migration_password') \gexec

SELECT format(
  'GRANT CONNECT ON DATABASE %I TO orda_runtime, orda_migrator',
  current_database()
) \gexec
GRANT USAGE ON SCHEMA public TO orda_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO orda_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO orda_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orda_runtime;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO orda_runtime;

REVOKE DELETE, TRUNCATE ON TABLE
  "Client", "Order", "Payment", "Measurement", "Document", "CalendarTask",
  "PayrollAccrual", "PayrollPayment", "Production", "AuditLog", "DeletionLog"
FROM orda_runtime;
REVOKE UPDATE ON TABLE "AuditLog" FROM orda_runtime;

-- Neon project owners cannot grant membership in the managed neondb_owner
-- role.  Keep migration authority separate by making the protected migrator
-- the owner of application objects while retaining the Neon owner as an
-- administrative member of that role. PostgreSQL automatically grants the
-- creating role ADMIN membership in a role it creates; an explicit self-grant
-- is rejected by PostgreSQL 16+. Neon creates that administrative membership
-- without SET/INHERIT, so add a separate least-privilege membership grant.
GRANT orda_migrator TO neondb_owner WITH INHERIT TRUE, SET TRUE;
ALTER SCHEMA public OWNER TO orda_migrator;

DO $$
DECLARE
  object record;
BEGIN
  FOR object IN
    SELECT c.relkind, n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
      AND (
        c.relkind <> 'S'
        OR NOT EXISTS (
          SELECT 1
          FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype IN ('a', 'i')
        )
      )
    ORDER BY CASE WHEN c.relkind IN ('r', 'p') THEN 0 ELSE 1 END, c.relname
  LOOP
    EXECUTE format(
      'ALTER %s %I.%I OWNER TO orda_migrator',
      CASE object.relkind
        WHEN 'S' THEN 'SEQUENCE'
        WHEN 'v' THEN 'VIEW'
        WHEN 'm' THEN 'MATERIALIZED VIEW'
        WHEN 'f' THEN 'FOREIGN TABLE'
        ELSE 'TABLE'
      END,
      object.nspname,
      object.relname
    );
  END LOOP;

  FOR object IN
    SELECT n.nspname, t.typname
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typtype IN ('e', 'd')
  LOOP
    EXECUTE format('ALTER TYPE %I.%I OWNER TO orda_migrator', object.nspname, object.typname);
  END LOOP;
END $$;

ALTER DEFAULT PRIVILEGES FOR ROLE orda_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO orda_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE orda_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO orda_runtime;

COMMENT ON ROLE orda_runtime IS 'ORDA application runtime: DML only; no destructive access to critical records';
COMMENT ON ROLE orda_migrator IS 'ORDA protected migration identity; credentials are not used by the application runtime';
