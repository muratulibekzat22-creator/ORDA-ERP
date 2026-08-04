ALTER TABLE "Partner" ADD COLUMN "userId" INTEGER;
ALTER TABLE "Measurement" ADD COLUMN "measurerUserId" INTEGER;
ALTER TABLE "Production" ADD COLUMN "masterUserId" INTEGER;

CREATE UNIQUE INDEX "Partner_userId_key" ON "Partner"("userId");

ALTER TABLE "Partner" ADD CONSTRAINT "Partner_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_measurerUserId_fkey"
  FOREIGN KEY ("measurerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Production" ADD CONSTRAINT "Production_masterUserId_fkey"
  FOREIGN KEY ("masterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
