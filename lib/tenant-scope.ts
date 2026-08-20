import type { getTenantRuntimeContext } from "@/lib/tenant-context";

type RuntimeContext = ReturnType<typeof getTenantRuntimeContext>;
type DataRow = Record<string, unknown>;

export type TenantQueryArguments = Record<string, unknown> & {
  where?: DataRow;
  data?: DataRow | DataRow[];
  create?: DataRow;
  update?: DataRow;
};

export const TENANT_MODELS = new Set([
  "User",
  "Client",
  "CommercialProposal",
  "Partner",
  "Order",
  "CalendarTask",
  "CompanyLedgerEntry",
  "FinanceCategory",
  "EmployeePayrollProfile",
  "PayrollPeriod",
  "PersonalLedgerEntry",
  "Document",
  "Attachment",
  "Material",
  "CompanySettings",
  "SystemSettings",
  "MaterialMovement",
  "Supplier",
  "PurchaseBatch",
  "InventoryValuationEntry",
  "InventoryCogsEntry",
  "MaterialReservation",
  "WarehouseMutation",
  "Measurement",
  "Payment",
  "CashShift",
  "CommercialAdjustment",
  "Production",
  "Settings",
  "CalculatorTariff",
  "OrderEvent",
  "RolePermission",
  "MarketingSource",
  "MarketingContactChannel",
  "MarketingCampaign",
  "MarketingAdSet",
  "MarketingAd",
  "MarketingCreative",
  "MarketingInquiry",
  "LeadAttribution",
  "MarketingTouch",
  "MarketingMetric",
  "MarketingSpend",
  "MarketingBudget",
  "MarketingAuditLog",
]);

const WHERE_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "delete",
  "deleteMany",
]);

function tenantData(data: DataRow | undefined, companyId: number) {
  if (data?.companyId !== undefined && data.companyId !== companyId) {
    throw new Error("TENANT_SCOPE_VIOLATION");
  }
  return { ...(data ?? {}), companyId };
}

export function applyTenantScope(
  model: string,
  operation: string,
  args: TenantQueryArguments,
  context: RuntimeContext,
) {
  if (!TENANT_MODELS.has(model)) return args;
  if (!context) throw new Error(`TENANT_CONTEXT_REQUIRED:${model}.${operation}`);
  if (context.kind === "system") return args;

  const companyId = context.companyId;
  if (WHERE_OPERATIONS.has(operation)) {
    args.where = { ...(args.where ?? {}), companyId };
  } else if (operation === "create") {
    args.data = tenantData(args.data as DataRow | undefined, companyId);
  } else if (operation === "createMany" || operation === "createManyAndReturn") {
    args.data = Array.isArray(args.data)
      ? args.data.map((row) => tenantData(row, companyId))
      : tenantData(args.data as DataRow | undefined, companyId);
  } else if (operation === "upsert") {
    args.where = { ...(args.where ?? {}), companyId };
    args.create = tenantData(args.create, companyId);
    if (args.update?.companyId !== undefined && args.update.companyId !== companyId) {
      throw new Error("TENANT_SCOPE_VIOLATION");
    }
  }

  return args;
}
