-- CreateTable
CREATE TABLE "Production" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "percent" INTEGER NOT NULL DEFAULT 0,
    "master" TEXT NOT NULL,
    "startDate" TIMESTAMP(3),
    "finishDate" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Production_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Production" ADD CONSTRAINT "Production_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
