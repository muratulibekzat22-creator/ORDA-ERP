-- Additive indexes for measured hot read paths. Existing rows and constraints are unchanged.
CREATE INDEX "Client_active_deletedAt_updatedAt_idx" ON "Client"("active", "deletedAt", "updatedAt");

CREATE INDEX "Order_deletedAt_createdAt_id_idx" ON "Order"("deletedAt", "createdAt", "id");
CREATE INDEX "Order_managerUserId_deletedAt_createdAt_idx" ON "Order"("managerUserId", "deletedAt", "createdAt");

CREATE INDEX "CompanyLedgerEntry_direction_operationDate_id_idx" ON "CompanyLedgerEntry"("direction", "operationDate", "id");

CREATE INDEX "Document_documentDate_id_idx" ON "Document"("documentDate", "id");

CREATE INDEX "Measurement_status_visitDate_idx" ON "Measurement"("status", "visitDate");
CREATE INDEX "Measurement_measurerUserId_status_visitDate_idx" ON "Measurement"("measurerUserId", "status", "visitDate");
CREATE INDEX "Measurement_completedAt_idx" ON "Measurement"("completedAt");

CREATE INDEX "Payment_operationDate_id_idx" ON "Payment"("operationDate", "id");
CREATE INDEX "Payment_orderId_operationDate_idx" ON "Payment"("orderId", "operationDate");
CREATE INDEX "Payment_partnerId_operationDate_idx" ON "Payment"("partnerId", "operationDate");

CREATE INDEX "Production_archivedAt_priority_createdAt_id_idx" ON "Production"("archivedAt", "priority", "createdAt", "id");
CREATE INDEX "Production_orderId_idx" ON "Production"("orderId");

CREATE INDEX "OrderEvent_createdAt_idx" ON "OrderEvent"("createdAt");
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
