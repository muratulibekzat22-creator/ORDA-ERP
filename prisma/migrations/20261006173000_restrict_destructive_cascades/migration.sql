-- Replace legacy destructive cascades with explicit retention boundaries.
-- NOT VALID avoids full-table locks while the equivalent existing FK is
-- replaced; every constraint is validated before this transaction commits.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '5min';

ALTER TABLE "LeadActivity" DROP CONSTRAINT "LeadActivity_clientId_fkey";
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LeadStatusHistory" DROP CONSTRAINT "LeadStatusHistory_clientId_fkey";
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LeadNextAction" DROP CONSTRAINT "LeadNextAction_clientId_fkey";
ALTER TABLE "LeadNextAction" ADD CONSTRAINT "LeadNextAction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LeadCalculation" DROP CONSTRAINT "LeadCalculation_clientId_fkey";
ALTER TABLE "LeadCalculation" ADD CONSTRAINT "LeadCalculation_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LeadPriceAdjustment" DROP CONSTRAINT "LeadPriceAdjustment_calculationId_fkey";
ALTER TABLE "LeadPriceAdjustment" ADD CONSTRAINT "LeadPriceAdjustment_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "LeadCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "LeadFollowUp" DROP CONSTRAINT "LeadFollowUp_clientId_fkey";
ALTER TABLE "LeadFollowUp" ADD CONSTRAINT "LeadFollowUp_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PriceApprovalRequest" DROP CONSTRAINT "PriceApprovalRequest_clientId_fkey";
ALTER TABLE "PriceApprovalRequest" ADD CONSTRAINT "PriceApprovalRequest_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "PriceApprovalRequest" DROP CONSTRAINT "PriceApprovalRequest_calculationId_fkey";
ALTER TABLE "PriceApprovalRequest" ADD CONSTRAINT "PriceApprovalRequest_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "LeadCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ClientInteraction" DROP CONSTRAINT "ClientInteraction_clientId_fkey";
ALTER TABLE "ClientInteraction" ADD CONSTRAINT "ClientInteraction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ClientAttachment" DROP CONSTRAINT "ClientAttachment_clientId_fkey";
ALTER TABLE "ClientAttachment" ADD CONSTRAINT "ClientAttachment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Order" DROP CONSTRAINT "Order_clientId_fkey";
ALTER TABLE "Order" ADD CONSTRAINT "Order_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SalesPlanTier" DROP CONSTRAINT "SalesPlanTier_planId_fkey";
ALTER TABLE "SalesPlanTier" ADD CONSTRAINT "SalesPlanTier_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "SalesPlanManagerTarget" DROP CONSTRAINT "SalesPlanManagerTarget_planId_fkey";
ALTER TABLE "SalesPlanManagerTarget" ADD CONSTRAINT "SalesPlanManagerTarget_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SalesPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OrderStatusHistory" DROP CONSTRAINT "OrderStatusHistory_orderId_fkey";
ALTER TABLE "OrderStatusHistory" ADD CONSTRAINT "OrderStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OrderCalculation" DROP CONSTRAINT "OrderCalculation_orderId_fkey";
ALTER TABLE "OrderCalculation" ADD CONSTRAINT "OrderCalculation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OrderCalculationLine" DROP CONSTRAINT "OrderCalculationLine_calculationId_fkey";
ALTER TABLE "OrderCalculationLine" ADD CONSTRAINT "OrderCalculationLine_calculationId_fkey" FOREIGN KEY ("calculationId") REFERENCES "OrderCalculation"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BankStatementTransaction" DROP CONSTRAINT "BankStatementTransaction_importId_fkey";
ALTER TABLE "BankStatementTransaction" ADD CONSTRAINT "BankStatementTransaction_importId_fkey" FOREIGN KEY ("importId") REFERENCES "BankStatementImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_orderId_fkey";
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_documentId_fkey";
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "MaterialPriceHistory" DROP CONSTRAINT "MaterialPriceHistory_materialId_fkey";
ALTER TABLE "MaterialPriceHistory" ADD CONSTRAINT "MaterialPriceHistory_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "MaterialMovement" DROP CONSTRAINT "MaterialMovement_materialId_fkey";
ALTER TABLE "MaterialMovement" ADD CONSTRAINT "MaterialMovement_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "Production" DROP CONSTRAINT "Production_orderId_fkey";
ALTER TABLE "Production" ADD CONSTRAINT "Production_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "ProductionStageHistory" DROP CONSTRAINT "ProductionStageHistory_productionId_fkey";
ALTER TABLE "ProductionStageHistory" ADD CONSTRAINT "ProductionStageHistory_productionId_fkey" FOREIGN KEY ("productionId") REFERENCES "Production"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "OrderEvent" DROP CONSTRAINT "OrderEvent_orderId_fkey";
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "LeadActivity" VALIDATE CONSTRAINT "LeadActivity_clientId_fkey";
ALTER TABLE "LeadStatusHistory" VALIDATE CONSTRAINT "LeadStatusHistory_clientId_fkey";
ALTER TABLE "LeadNextAction" VALIDATE CONSTRAINT "LeadNextAction_clientId_fkey";
ALTER TABLE "LeadCalculation" VALIDATE CONSTRAINT "LeadCalculation_clientId_fkey";
ALTER TABLE "LeadPriceAdjustment" VALIDATE CONSTRAINT "LeadPriceAdjustment_calculationId_fkey";
ALTER TABLE "LeadFollowUp" VALIDATE CONSTRAINT "LeadFollowUp_clientId_fkey";
ALTER TABLE "PriceApprovalRequest" VALIDATE CONSTRAINT "PriceApprovalRequest_clientId_fkey";
ALTER TABLE "PriceApprovalRequest" VALIDATE CONSTRAINT "PriceApprovalRequest_calculationId_fkey";
ALTER TABLE "ClientInteraction" VALIDATE CONSTRAINT "ClientInteraction_clientId_fkey";
ALTER TABLE "ClientAttachment" VALIDATE CONSTRAINT "ClientAttachment_clientId_fkey";
ALTER TABLE "Order" VALIDATE CONSTRAINT "Order_clientId_fkey";
ALTER TABLE "SalesPlanTier" VALIDATE CONSTRAINT "SalesPlanTier_planId_fkey";
ALTER TABLE "SalesPlanManagerTarget" VALIDATE CONSTRAINT "SalesPlanManagerTarget_planId_fkey";
ALTER TABLE "OrderStatusHistory" VALIDATE CONSTRAINT "OrderStatusHistory_orderId_fkey";
ALTER TABLE "OrderCalculation" VALIDATE CONSTRAINT "OrderCalculation_orderId_fkey";
ALTER TABLE "OrderCalculationLine" VALIDATE CONSTRAINT "OrderCalculationLine_calculationId_fkey";
ALTER TABLE "BankStatementTransaction" VALIDATE CONSTRAINT "BankStatementTransaction_importId_fkey";
ALTER TABLE "Attachment" VALIDATE CONSTRAINT "Attachment_orderId_fkey";
ALTER TABLE "Attachment" VALIDATE CONSTRAINT "Attachment_documentId_fkey";
ALTER TABLE "MaterialPriceHistory" VALIDATE CONSTRAINT "MaterialPriceHistory_materialId_fkey";
ALTER TABLE "MaterialMovement" VALIDATE CONSTRAINT "MaterialMovement_materialId_fkey";
ALTER TABLE "Production" VALIDATE CONSTRAINT "Production_orderId_fkey";
ALTER TABLE "ProductionStageHistory" VALIDATE CONSTRAINT "ProductionStageHistory_productionId_fkey";
ALTER TABLE "OrderEvent" VALIDATE CONSTRAINT "OrderEvent_orderId_fkey";

INSERT INTO "AuditLog" ("companyId", "actorRole", "action", "entityType", "entityId", "reason", "after", "requestId")
SELECT 1, 'MIGRATION', 'SCHEMA_MIGRATION_APPLIED', 'SCHEMA', '20261006173000_restrict_destructive_cascades',
       'Replaced legacy ON DELETE CASCADE foreign keys with RESTRICT',
       '{"deleteAction":"RESTRICT","validated":true}'::jsonb,
       'migration:20261006173000_restrict_destructive_cascades'
WHERE EXISTS (SELECT 1 FROM "Company" WHERE "id" = 1);

COMMIT;
