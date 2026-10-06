import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const protectedConstraints = [
  "LeadActivity_clientId_fkey",
  "LeadStatusHistory_clientId_fkey",
  "LeadNextAction_clientId_fkey",
  "LeadCalculation_clientId_fkey",
  "LeadPriceAdjustment_calculationId_fkey",
  "LeadFollowUp_clientId_fkey",
  "PriceApprovalRequest_clientId_fkey",
  "PriceApprovalRequest_calculationId_fkey",
  "ClientInteraction_clientId_fkey",
  "ClientAttachment_clientId_fkey",
  "Order_clientId_fkey",
  "SalesPlanTier_planId_fkey",
  "SalesPlanManagerTarget_planId_fkey",
  "OrderStatusHistory_orderId_fkey",
  "OrderCalculation_orderId_fkey",
  "OrderCalculationLine_calculationId_fkey",
  "BankStatementTransaction_importId_fkey",
  "Attachment_orderId_fkey",
  "Attachment_documentId_fkey",
  "MaterialPriceHistory_materialId_fkey",
  "MaterialMovement_materialId_fkey",
  "Production_orderId_fkey",
  "ProductionStageHistory_productionId_fkey",
  "OrderEvent_orderId_fkey",
] as const;

async function main() {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const constraints = await pool.query<{ conname: string; delete_action: string; convalidated: boolean }>(
      `SELECT conname,
              CASE confdeltype WHEN 'r' THEN 'RESTRICT' WHEN 'a' THEN 'NO ACTION'
                   WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                   WHEN 'd' THEN 'SET DEFAULT' ELSE confdeltype::text END AS delete_action,
              convalidated
         FROM pg_constraint
        WHERE conname = ANY($1::text[])
        ORDER BY conname`,
      [protectedConstraints],
    );
    const migration = await pool.query<{ applied: string }>(
      `SELECT count(*)::text AS applied
         FROM "_prisma_migrations"
        WHERE migration_name = '20261006173000_restrict_destructive_cascades'
          AND finished_at IS NOT NULL
          AND rolled_back_at IS NULL`,
    );
    const missing = protectedConstraints.filter((name) => !constraints.rows.some((row) => row.conname === name));
    const unsafe = constraints.rows.filter((row) => row.delete_action !== "RESTRICT" || !row.convalidated);
    if (missing.length || unsafe.length || migration.rows[0]?.applied !== "1") {
      throw new Error(`FK retention verification failed: missing=${missing.length}, unsafe=${unsafe.length}, migration=${migration.rows[0]?.applied ?? "0"}`);
    }
    console.log(JSON.stringify({
      status: "passed",
      protectedConstraints: constraints.rowCount,
      restrict: constraints.rows.filter((row) => row.delete_action === "RESTRICT").length,
      validated: constraints.rows.filter((row) => row.convalidated).length,
      migrationApplied: true,
    }));
  } finally {
    await pool.end();
  }
}

void main();
