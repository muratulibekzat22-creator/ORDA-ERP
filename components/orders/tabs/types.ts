export type NumericValue = string | number | { toString(): string };

export type OrderTabData = {
  id: number;
  number: string;
  status: string;
  lifecycle: string;
  version: number;
  createdAt: Date | string;
  orderReceivedAt: Date | string;
  promisedAt: Date | string | null;
  completedAt: Date | string | null;
  financialClosedAt: Date | string | null;
  contractConfirmedAt: Date | string | null;
  workshopConfirmedAt: Date | string | null;
  installationCompleted: boolean;
  address: string;
  mapUrl: string;
  staircase: string;
  material: string;
  frameComment: string;
  railingType: string;
  supportType: string;
  color: string;
  lighting: boolean;
  lightingDetails: string;
  cladding: boolean;
  claddingDetails: string;
  additionalDetails: string;
  paymentMethod: string;
  manager: string;
  amount: NumericValue;
  prepayment: NumericValue;
  balance: NumericValue;
  partnerPrice: NumericValue;
  companyProfit: NumericValue;
  partnerPaid: NumericValue;
  partnerBalance: NumericValue;
  client: {
    id: number;
    name: string;
    phone: string;
    whatsapp: string;
    city: string;
    address: string;
    iin: string;
    comment: string;
  };
  partner: {
    id: number;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    active: boolean;
  } | null;
  documents: Array<{
    type: string;
    status: string;
  }>;
  defaultWorkshop?: { id: number; name: string } | null;
  costPlan?: {
    materialOutsideWorkshop: NumericValue;
    delivery: NumericValue;
    bankFees: NumericValue;
    otherDirect: NumericValue;
    confirmedAt: Date | string | null;
  } | null;
  settlement?: {
    cancelled: boolean;
    client?: { total: number; receivedGross: number; refunds: number; received: number; remaining: number; overpayment: number; dueAt: Date | string | null; status: string };
    partner?: {
      partnerId: number | null; partnerName: string | null; priceSet: boolean; agreed: number | null; paid: number; pending: number; remaining: number; overpayment: number; status: string;
      payouts: Array<{ id: number; amount: number; type: string; method: string; comment: string | null; author: string | null; operationDate: Date | string | null }>;
      assignments: Array<{ id: number; newPayable: number; reason: string; createdAt: Date | string; authorName: string | null }>;
      history?: {
        relationId: number; startsAt: Date | string; workDueAt: Date | string | null; paymentDueAt: Date | string | null;
        comment: string | null; createdAt: Date | string; createdBy: string | null;
        operations: Array<{ id: number; type: string; status: string; amount: number; adjustmentEffect: number; operationDate: Date | string; method: string | null; account: string | null; comment: string | null; paymentId: number | null; reversalOfId: number | null; reversalId: number | null; author: string | null }>;
        audit: Array<{ id: number; action: string; comment: string | null; createdAt: Date | string; actor: string | null }>;
      } | null;
    };
    manager?: EmployeeSettlement;
    measurer?: EmployeeSettlement;
  };
  economy?: {
    client: {
      contractAmount: NumericValue; additionalWorks: NumericValue; discounts: NumericValue;
      totalSale: NumericValue; receivedGross: NumericValue; refunds: NumericValue;
      netReceived: NumericValue; remaining: NumericValue; dueAt: Date | string | null;
      overdueAmount: NumericValue; status: string;
    };
    partner: {
      agreed: NumericValue; agreedAt: Date | string | null; agreedBy: string | null;
      accrued: NumericValue; paid: NumericValue; remaining: NumericValue;
      dueAt: Date | string | null; status: string;
    };
    profit: {
      totalSale: NumericValue; partnerCost: NumericValue; directExpenses: NumericValue;
      materials: NumericValue; delivery: NumericValue; contractors: NumericValue;
      bankFees: NumericValue; otherDirectExpenses: NumericValue;
      marginBeforePayroll: NumericValue; managerBonus: NumericValue; measurer: NumericValue;
      installers: NumericValue; driver: NumericValue; expediter: NumericValue;
      otherPayroll: NumericValue; payrollAccrued: NumericValue; netProfit: NumericValue;
      netMarginPercent: NumericValue;
      complete: boolean;
      costsConfirmed: boolean;
      label: string;
      warning: string | null;
      mode: "ACTUAL" | "PLANNED";
    };
    directCosts: {
      plan: { materials: NumericValue; delivery: NumericValue; bankFees: NumericValue; otherDirect: NumericValue; total: NumericValue; confirmed: boolean };
      fact: { materials: NumericValue; delivery: NumericValue; bankFees: NumericValue; otherDirect: NumericValue; total: NumericValue };
      deviation: { materials: NumericValue; delivery: NumericValue; bankFees: NumericValue; otherDirect: NumericValue; total: NumericValue };
    };
    cash: {
      clientReceived: NumericValue; partnerPaid: NumericValue; payrollPaid: NumericValue;
      otherExpensesPaid: NumericValue; balance: NumericValue;
    };
  };
  measurements: Array<{
    id: number;
    measurer: string;
    visitDate: Date | string;
    floorHeight: number | null;
    staircaseWidth: number | null;
    stepsCount: number | null;
    comment: string | null;
  }>;
  productions: Array<{
    id: number;
    stage: string;
    percent: number;
    master: string;
    comment: string | null;
    startDate: Date | string | null;
    finishDate: Date | string | null;
    plannedStartAt?: Date | string | null;
    plannedEndAt?: Date | string | null;
    actualEndAt?: Date | string | null;
  }>;
  events: Array<{
    id: number;
    title: string;
    description: string | null;
    user: string | null;
    createdAt: Date | string;
  }>;
  statusHistory: Array<{
    id: number;
    fromStatus: string | null;
    toStatus: string;
    changedByName: string;
    changedByRole: string;
    comment: string | null;
    createdAt: Date | string;
  }>;
  calculations: Array<{
    id: number;
    material: string;
    regularSteps: number;
    platformEquivalents: number[];
    equivalentSteps: number;
    clientPrice: NumericValue;
    installationRequired?: boolean;
    deliveryRequired?: boolean;
    createdAt?: Date | string;
    lines?: Array<{
      id: number;
      name: string;
      kind: string;
      quantity: NumericValue;
      unit: string;
      totalSale: NumericValue;
      comment: string | null;
      enabled: boolean;
    }>;
  }>;
};

export type EmployeeSettlement = {
  userId: number | null;
  employeeId: number | null;
  name: string | null;
  accrued: number;
  paid: number;
  remaining: number;
  status: string;
  accruals: Array<{
    id: number;
    periodId: number;
    employeeId: number;
    userId: number | null;
    employeeName: string;
    type: string;
    amount: number;
    paid: number;
    remaining: number;
    status: string;
    measurementId: number | null;
    createdAt: Date | string;
  }>;
};
