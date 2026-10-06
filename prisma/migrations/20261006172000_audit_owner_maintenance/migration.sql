-- Application runtime users remain unable to mutate AuditLog. The protected
-- migration owner retains a narrowly privileged maintenance path for FK
-- maintenance and disaster recovery.
CREATE OR REPLACE FUNCTION forbid_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF pg_has_role(current_user, 'neondb_owner', 'MEMBER') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditLog is append-only' USING ERRCODE = '42501';
END;
$$;
