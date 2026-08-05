-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('OFFER', 'CONTRACT', 'ACT', 'INVOICE');

-- CreateTable
CREATE TABLE "Document" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Document_orderId_type_key" ON "Document"("orderId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "Document_type_number_key" ON "Document"("type", "number");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
