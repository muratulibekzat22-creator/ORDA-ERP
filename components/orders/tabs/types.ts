export type NumericValue = string | number | { toString(): string };

export type OrderTabData = {
  id: number;
  number: string;
  status: string;
  lifecycle: string;
  version: number;
  createdAt: Date | string;
  address: string;
  staircase: string;
  material: string;
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
  };
  partner: {
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    active: boolean;
  } | null;
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
