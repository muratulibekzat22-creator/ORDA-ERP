-- The legacy company/month uniqueness prevents creating the same payroll month
-- in a later year. The canonical company/year/month index already exists.
DROP INDEX IF EXISTS "PayrollPeriod_companyId_month_key";
