ALTER TABLE "OrderCalculation" DROP CONSTRAINT "OrderCalculation_orderId_fkey";
ALTER TABLE "OrderCalculation" ADD CONSTRAINT "OrderCalculation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MaterialMovement" DROP CONSTRAINT "MaterialMovement_orderId_fkey";
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Production" DROP CONSTRAINT "Production_orderId_fkey";
ALTER TABLE "Production" ADD CONSTRAINT "Production_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
