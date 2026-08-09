import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";

type Row = Record<string, unknown>;
type Delegate = {
  count(): Promise<number>;
  findMany(): Promise<Row[]>;
  deleteMany(args: { where: { id: { in: number[] } } }): Promise<{ count: number }>;
  updateMany(args: { where: { id: { in: number[] } }; data: Row }): Promise<{ count: number }>;
};

async function main() {
const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/u, "").split("=");
    return [key, rest.length ? rest.join("=") : "true"];
  }),
);
const apply = args.get("apply") === "true";
const expectedConfirmation = "ORDA-PRODUCTION-GO-LIVE-CLEANUP";
const backupPath = args.get("backup");
const backupSha256 = args.get("backup-sha256")?.toLowerCase();
const outputPath = resolve(args.get("output") ?? `backups/production-go-live/${apply ? "apply" : "dry-run"}-report.json`);

if (args.get("production") !== "true") throw new Error("--production is required");
if (!backupPath || !backupSha256) throw new Error("--backup and --backup-sha256 are required");
if (apply && args.get("confirm") !== expectedConfirmation) {
  throw new Error(`Mutation requires --confirm=${expectedConfirmation}`);
}
if (!process.env.DATABASE_URL || process.env.DATABASE_URL === process.env.TEST_DATABASE_URL) {
  throw new Error("A distinct production DATABASE_URL is required");
}

const databaseUrl = new URL(process.env.DATABASE_URL);
if (!/^postgres(?:ql)?:$/iu.test(databaseUrl.protocol) || /localhost|127\.0\.0\.1/iu.test(databaseUrl.hostname)) {
  throw new Error("DATABASE_URL did not pass production host checks");
}
const actualBackupSha256 = createHash("sha256").update(readFileSync(resolve(backupPath))).digest("hex");
if (actualBackupSha256 !== backupSha256) throw new Error("Backup checksum does not match");

const delegateName = (model: string) => `${model[0].toLowerCase()}${model.slice(1)}`;
const db = prisma as unknown as Record<string, Delegate>;
const rows = new Map<string, Row[]>();
const inventory: Record<string, number> = {};
for (const model of Prisma.dmmf.datamodel.models) {
  const delegate = db[delegateName(model.name)];
  if (!delegate) continue;
  const modelRows = await delegate.findMany();
  rows.set(model.name, modelRows);
  inventory[model.name] = modelRows.length;
}

const companySettings = rows.get("CompanySettings") ?? [];
if (!companySettings.some((row) => /ALTYN\s+SAPA/iu.test(String(row.name ?? "")))) {
  throw new Error("ALTYN SAPA production company identity was not found");
}
const migrationState = await prisma.$queryRaw<Array<{ total: bigint; unfinished: bigint }>>`
  SELECT COUNT(*)::bigint AS total,
         COUNT(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)::bigint AS unfinished
  FROM "_prisma_migrations"
`;
if (!migrationState[0] || Number(migrationState[0].unfinished) !== 0) {
  throw new Error("Production migrations are unfinished or rolled back");
}

const marker = /(?:^|[^\p{L}\p{N}])(TEST|DEMO|API[ _-]?SECURITY|E2E|RBAC|ACCEPTANCE|SECURITY)(?:[^\p{L}\p{N}]|$)/iu;
const prefixMarker = /^(?:test|demo|api-security|e2e|rbac|acceptance|security)-/iu;
const protectedModels = new Set([
  "CompanySettings",
  "SystemSettings",
  "Settings",
  "CalculatorTariff",
  "RolePermission",
  "WarehouseCodeCounter",
  "PayrollPeriod",
  "AuthAuditEvent",
]);
const forensicModels = new Set(["AuthAuditEvent", "PayrollAuditEvent"]);
const targets = new Map<string, Map<number, Set<string>>>();

function idOf(row: Row) {
  return typeof row.id === "number" ? row.id : null;
}
function targetIds(model: string) {
  return new Set(targets.get(model)?.keys() ?? []);
}
function addTarget(model: string, row: Row, reason: string) {
  const id = idOf(row);
  if (id === null || protectedModels.has(model) || forensicModels.has(model)) return false;
  let modelTargets = targets.get(model);
  if (!modelTargets) {
    modelTargets = new Map();
    targets.set(model, modelTargets);
  }
  let reasons = modelTargets.get(id);
  const isNew = !reasons;
  if (!reasons) {
    reasons = new Set();
    modelTargets.set(id, reasons);
  }
  reasons.add(reason);
  return isNew;
}
function hasMarker(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return marker.test(text) || prefixMarker.test(text);
}

for (const [model, modelRows] of rows) {
  if (protectedModels.has(model) || forensicModels.has(model)) continue;
  for (const row of modelRows) {
    const direct = Object.entries(row).some(
      ([key, value]) => !["password", "createdAt", "updatedAt"].includes(key) && hasMarker(value),
    );
    if (direct) addTarget(model, row, "explicit TEST/DEMO/acceptance marker");
  }
}

const relations: Array<[child: string, foreignKey: string, parent: string]> = [
  ["LeadActivity", "clientId", "Client"],
  ["LeadStatusHistory", "clientId", "Client"],
  ["LeadNextAction", "clientId", "Client"],
  ["LeadCalculation", "clientId", "Client"],
  ["CommercialProposal", "clientId", "Client"],
  ["LeadFollowUp", "clientId", "Client"],
  ["PriceApprovalRequest", "clientId", "Client"],
  ["LeadConversion", "clientId", "Client"],
  ["ClientInteraction", "clientId", "Client"],
  ["ClientAttachment", "clientId", "Client"],
  ["Order", "clientId", "Client"],
  ["CalendarTask", "clientId", "Client"],
  ["Measurement", "clientId", "Client"],
  ["Document", "clientId", "Client"],
  ["LeadPriceAdjustment", "calculationId", "LeadCalculation"],
  ["CommercialProposal", "calculationId", "LeadCalculation"],
  ["LeadFollowUp", "calculationId", "LeadCalculation"],
  ["PriceApprovalRequest", "calculationId", "LeadCalculation"],
  ["LeadConversion", "proposalId", "CommercialProposal"],
  ["CalendarTaskAudit", "taskId", "CalendarTask"],
  ["OrderBlocker", "orderId", "Order"],
  ["OrderGateOverride", "orderId", "Order"],
  ["OrderLifecycleEvent", "orderId", "Order"],
  ["OrderInstallation", "orderId", "Order"],
  ["OrderStatusHistory", "orderId", "Order"],
  ["OrderCalculation", "orderId", "Order"],
  ["CompanyLedgerEntry", "orderId", "Order"],
  ["Document", "orderId", "Order"],
  ["Attachment", "orderId", "Order"],
  ["MaterialMovement", "orderId", "Order"],
  ["InventoryCogsEntry", "orderId", "Order"],
  ["MaterialReservation", "orderId", "Order"],
  ["Measurement", "orderId", "Order"],
  ["Payment", "orderId", "Order"],
  ["CommercialAdjustment", "orderId", "Order"],
  ["PartnerAssignmentHistory", "orderId", "Order"],
  ["FinanceAuditEvent", "orderId", "Order"],
  ["Production", "orderId", "Order"],
  ["OrderEvent", "orderId", "Order"],
  ["PayrollAccrual", "orderId", "Order"],
  ["LeadConversion", "orderId", "Order"],
  ["CalendarTask", "orderId", "Order"],
  ["OrderCalculationLine", "calculationId", "OrderCalculation"],
  ["ProductionStageHistory", "productionId", "Production"],
  ["DocumentVersion", "documentId", "Document"],
  ["DocumentAudit", "documentId", "Document"],
  ["Attachment", "documentId", "Document"],
  ["MeasurementAttachment", "measurementId", "Measurement"],
  ["MeasurementAudit", "measurementId", "Measurement"],
  ["PayrollAccrual", "measurementId", "Measurement"],
  ["CompanyLedgerEntry", "payrollAccrualId", "PayrollAccrual"],
  ["CompanyLedgerEntry", "payrollPaymentId", "PayrollPayment"],
  ["Measurement", "calendarTaskId", "CalendarTask"],
  ["MaterialPriceHistory", "materialId", "Material"],
  ["MaterialMovement", "materialId", "Material"],
  ["PurchaseBatchLine", "materialId", "Material"],
  ["InventoryValuationEntry", "materialId", "Material"],
  ["InventoryCogsEntry", "materialId", "Material"],
  ["MaterialReservation", "materialId", "Material"],
  ["PurchaseBatchLine", "batchId", "PurchaseBatch"],
  ["PurchaseAdditionalCost", "batchId", "PurchaseBatch"],
  ["PurchaseCostRevision", "batchId", "PurchaseBatch"],
  ["MaterialMovement", "purchaseBatchLineId", "PurchaseBatchLine"],
  ["InventoryCogsEntry", "movementId", "MaterialMovement"],
  ["EmployeePayrollProfile", "userId", "User"],
  ["EmployeeSalaryRate", "employeeId", "EmployeePayrollProfile"],
  ["PayrollAccrual", "employeeId", "EmployeePayrollProfile"],
  ["PayrollPayment", "employeeId", "EmployeePayrollProfile"],
  ["PayrollAdvanceRequest", "employeeId", "EmployeePayrollProfile"],
];

let changed = true;
while (changed) {
  changed = false;
  for (const [child, foreignKey, parent] of relations) {
    const parentIds = targetIds(parent);
    if (!parentIds.size) continue;
    for (const row of rows.get(child) ?? []) {
      if (typeof row[foreignKey] === "number" && parentIds.has(row[foreignKey] as number)) {
        changed = addTarget(child, row, `linked ${parent}.${foreignKey}`) || changed;
      }
    }
  }
  for (const measurement of rows.get("Measurement") ?? []) {
    const measurementId = idOf(measurement);
    if (measurementId !== null && targetIds("Measurement").has(measurementId) && typeof measurement.calendarTaskId === "number") {
      const task = (rows.get("CalendarTask") ?? []).find((row) => row.id === measurement.calendarTaskId);
      if (task) changed = addTarget("CalendarTask", task, "linked test Measurement") || changed;
    }
  }
  const targetedLines = targetIds("PurchaseBatchLine");
  for (const batch of rows.get("PurchaseBatch") ?? []) {
    const batchId = idOf(batch);
    if (batchId === null) continue;
    const lines = (rows.get("PurchaseBatchLine") ?? []).filter((row) => row.batchId === batchId);
    if (lines.length > 0 && lines.every((row) => targetedLines.has(Number(row.id)))) {
      changed = addTarget("PurchaseBatch", batch, "all purchase lines are confirmed test data") || changed;
    }
  }
}

for (const known of [
  { model: "Client", id: 924 },
  { model: "Measurement", id: 234 },
  { model: "Measurement", id: 235 },
  { model: "CalendarTask", id: 132 },
]) {
  const row = (rows.get(known.model) ?? []).find((item) => item.id === known.id);
  if (row && !targetIds(known.model).has(known.id)) {
    // Number alone is never evidence. It remains intentionally preserved.
  }
}

const testUserIds = targetIds("User");
const directorTestIds = new Set(
  (rows.get("User") ?? [])
    .filter((row) => testUserIds.has(Number(row.id)) && String(row.role) === "DIRECTOR")
    .map((row) => Number(row.id)),
);
const deactivatableUserIds = [...testUserIds];
const deactivatableEmployeeIds = [...targetIds("EmployeePayrollProfile")];
const deactivatablePartnerIds = [...targetIds("Partner")];
const deactivatableSupplierIds = [...targetIds("Supplier")];

const preserveOnlyModels = new Set(["User", "EmployeePayrollProfile", "Partner", "Supplier"]);
const deleteOrder = [
  "LeadConversion",
  "CompanyLedgerEntry",
  "PayrollAdvanceRequest",
  "PayrollPayment",
  "PayrollAccrual",
  "EmployeeSalaryRate",
  "PersonalLedgerEntry",
  "InventoryCogsEntry",
  "InventoryValuationEntry",
  "MaterialReservation",
  "MaterialMovement",
  "WarehouseMutation",
  "PurchaseCostRevision",
  "PurchaseAdditionalCost",
  "PurchaseBatchLine",
  "PurchaseBatch",
  "MeasurementAttachment",
  "MeasurementAudit",
  "DocumentVersion",
  "DocumentAudit",
  "Attachment",
  "Document",
  "OrderCalculationLine",
  "OrderCalculation",
  "OrderBlocker",
  "OrderGateOverride",
  "OrderLifecycleEvent",
  "OrderInstallation",
  "OrderStatusHistory",
  "CommercialAdjustment",
  "PartnerAssignmentHistory",
  "FinanceAuditEvent",
  "Payment",
  "ProductionStageHistory",
  "Production",
  "OrderEvent",
  "Measurement",
  "CalendarTaskAudit",
  "CalendarTask",
  "LeadPriceAdjustment",
  "LeadFollowUp",
  "PriceApprovalRequest",
  "CommercialProposal",
  "LeadCalculation",
  "LeadActivity",
  "LeadStatusHistory",
  "LeadNextAction",
  "ClientInteraction",
  "ClientAttachment",
  "Order",
  "Client",
  "MaterialPriceHistory",
  "Material",
] as const;

const candidateCounts = Object.fromEntries(
  [...targets.entries()].map(([model, ids]) => [model, ids.size] as const).sort(([a], [b]) => a.localeCompare(b)),
);
const candidateReasons = Object.fromEntries(
  [...targets.entries()].map(([model, ids]) => {
    const reasonCounts: Record<string, number> = {};
    for (const reasons of ids.values()) for (const reason of reasons) reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    return [model, reasonCounts];
  }),
);
const preservedCounts = Object.fromEntries(
  Object.entries(inventory).map(([model, count]) => [model, count - (preserveOnlyModels.has(model) ? 0 : (candidateCounts[model] ?? 0))]),
);
const sequenceSnapshot = (rows.get("SystemSettings") ?? []).map((row) => ({
  id: row.id,
  nextDocumentNumber: row.nextDocumentNumber,
  nextContractNumber: row.nextContractNumber,
  offerPrefix: row.offerPrefix,
  contractPrefix: row.contractPrefix,
  actPrefix: row.actPrefix,
  invoicePrefix: row.invoicePrefix,
}));
const blobPaths = new Set<string>();
for (const model of ["ClientAttachment", "MeasurementAttachment", "DocumentVersion", "Attachment"] as const) {
  for (const row of rows.get(model) ?? []) {
    if (typeof row.id === "number" && targetIds(model).has(row.id) && typeof row.pathname === "string") blobPaths.add(row.pathname);
  }
}
for (const row of rows.get("Document") ?? []) {
  if (typeof row.id === "number" && targetIds("Document").has(row.id) && typeof row.signedPathname === "string") blobPaths.add(row.signedPathname);
}

const deletedCounts: Record<string, number> = {};
const deactivatedCounts = { User: 0, EmployeePayrollProfile: 0, Partner: 0, Supplier: 0 };
if (apply) {
  await prisma.$transaction(async (tx) => {
    const transactionDb = tx as unknown as Record<string, Delegate>;
    for (const model of deleteOrder) {
      const ids = [...targetIds(model)];
      if (!ids.length) continue;
      const result = await transactionDb[delegateName(model)].deleteMany({ where: { id: { in: ids } } });
      if (result.count !== ids.length) throw new Error(`${model}: expected ${ids.length} deletes, got ${result.count}`);
      deletedCounts[model] = result.count;
    }
    if (deactivatableEmployeeIds.length) {
      deactivatedCounts.EmployeePayrollProfile = (await transactionDb.employeePayrollProfile.updateMany({
        where: { id: { in: deactivatableEmployeeIds } },
        data: { active: false, payrollEnabled: false },
      })).count;
    }
    if (deactivatablePartnerIds.length) {
      deactivatedCounts.Partner = (await transactionDb.partner.updateMany({
        where: { id: { in: deactivatablePartnerIds } }, data: { active: false },
      })).count;
    }
    if (deactivatableSupplierIds.length) {
      deactivatedCounts.Supplier = (await transactionDb.supplier.updateMany({
        where: { id: { in: deactivatableSupplierIds } }, data: { active: false },
      })).count;
    }
    if (deactivatableUserIds.length) {
      deactivatedCounts.User = (await transactionDb.user.updateMany({
        where: { id: { in: deactivatableUserIds } },
        data: { active: false, sessionVersion: { increment: 1 } } as unknown as Row,
      })).count;
    }
  }, { timeout: 120_000 });
}

const report = {
  mode: apply ? "apply" : "dry-run",
  generatedAt: new Date().toISOString(),
  safety: {
    productionHost: databaseUrl.hostname,
    companyIdentity: "ALTYN SAPA confirmed",
    backupPath: resolve(backupPath),
    backupSha256: actualBackupSha256,
    migrations: { total: Number(migrationState[0].total), unfinished: Number(migrationState[0].unfinished) },
  },
  inventory,
  candidateCounts,
  candidateReasons,
  candidateIds: Object.fromEntries([...targets.entries()].map(([model, ids]) => [model, [...ids.keys()].sort((a, b) => a - b)])),
  preservedUnknownOrRealCounts: preservedCounts,
  protectedDirectorTestUserIds: [...directorTestIds],
  sequenceSnapshot,
  blobPaths: [...blobPaths].sort(),
  deletedCounts,
  deactivatedCounts,
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8" });
console.log(JSON.stringify({
  mode: report.mode,
  outputPath,
  candidateCounts,
  protectedDirectorTestUsers: directorTestIds.size,
  blobObjects: blobPaths.size,
  deletedCounts,
  deactivatedCounts,
}));

}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
