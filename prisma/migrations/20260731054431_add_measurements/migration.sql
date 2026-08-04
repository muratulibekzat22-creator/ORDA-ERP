-- CreateTable
CREATE TABLE "Measurement" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "measurer" TEXT NOT NULL,
    "visitDate" TIMESTAMP(3) NOT NULL,
    "floorHeight" DOUBLE PRECISION,
    "staircaseWidth" DOUBLE PRECISION,
    "stepsCount" INTEGER,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Measurement_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Measurement" ADD CONSTRAINT "Measurement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
