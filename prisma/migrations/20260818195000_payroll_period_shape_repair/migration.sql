-- Restore the canonical PayrollPeriod (year INT, month INT) shape after the
-- legacy Demo schema stored month as a calendar date. Existing periods keep
-- their original calendar month and tenant.
DO $$
DECLARE
  month_type text;
BEGIN
  SELECT data_type INTO month_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'PayrollPeriod'
    AND column_name = 'month';

  IF month_type IN ('date', 'timestamp without time zone', 'timestamp with time zone') THEN
    UPDATE "PayrollPeriod"
    SET "year" = COALESCE("year", EXTRACT(YEAR FROM "month")::integer);

    ALTER TABLE "PayrollPeriod" ALTER COLUMN "month" DROP DEFAULT;
    ALTER TABLE "PayrollPeriod"
      ALTER COLUMN "month" TYPE integer
      USING EXTRACT(MONTH FROM "month")::integer;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "PayrollPeriod" WHERE "year" IS NULL OR "month" IS NULL
  ) THEN
    RAISE EXCEPTION 'PayrollPeriod contains rows without a recoverable year/month';
  END IF;

  ALTER TABLE "PayrollPeriod" ALTER COLUMN "year" SET NOT NULL;
  ALTER TABLE "PayrollPeriod" ALTER COLUMN "month" SET NOT NULL;
END $$;
