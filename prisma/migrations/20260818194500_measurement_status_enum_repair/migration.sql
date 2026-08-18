-- Repair the legacy production column left as TEXT while preserving every
-- measurement. The historical SCHEDULED value is the canonical ASSIGNED state.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'Measurement'
      AND column_name = 'status'
      AND udt_name <> 'MeasurementStatus'
  ) THEN
    ALTER TABLE "Measurement" ALTER COLUMN "status" DROP DEFAULT;
    ALTER TABLE "Measurement"
      ALTER COLUMN "status" TYPE "MeasurementStatus"
      USING (
        CASE "status"
          WHEN 'SCHEDULED' THEN 'ASSIGNED'
          WHEN 'ASSIGNED' THEN 'ASSIGNED'
          WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
          WHEN 'COMPLETED' THEN 'COMPLETED'
          WHEN 'HANDED_TO_MANAGER' THEN 'HANDED_TO_MANAGER'
          WHEN 'CANCELLED' THEN 'CANCELLED'
          ELSE 'ASSIGNED'
        END
      )::"MeasurementStatus";
    ALTER TABLE "Measurement"
      ALTER COLUMN "status" SET DEFAULT 'ASSIGNED'::"MeasurementStatus";
  END IF;
END $$;
