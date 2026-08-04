-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "number" TEXT NOT NULL,
    "clientId" INTEGER NOT NULL,
    "address" TEXT NOT NULL,
    "staircase" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "amount" TEXT NOT NULL,
    "prepayment" TEXT NOT NULL DEFAULT '0',
    "balance" TEXT NOT NULL DEFAULT '0',
    "manager" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Новая заявка',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
