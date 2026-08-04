export interface Client {
  id: number;

  name: string;
  phone: string;
  city: string;

  manager: string;

  amount: string;
  status: string;

  orders?: Order[];

  createdAt: Date;
  updatedAt: Date;
}

export interface Partner {
  id: number;

  name: string;
  phone?: string;
  city?: string;
  email?: string;

  active: boolean;

  orders: Order[];

  stats?: {
    totalOrders: number;
    totalAmount: number;
    partnerPaid: number;
    partnerBalance: number;
    companyProfit: number;
  };

  createdAt: Date;
  updatedAt: Date;
}

export interface Order {
  id: number;

  number: string;

  clientId: number;
  client: Client;

  partnerId?: number | null;
  partner?: Partner | null;

  address: string;
  staircase: string;
  material: string;

  amount: string;
  prepayment: string;
  balance: string;

  partnerPrice: string;
  companyProfit: string;
  partnerPaid: string;
  partnerBalance: string;

  manager: string;
  status: string;

  measurements?: Measurement[];
  payments?: Payment[];
  productions?: Production[];
  events?: OrderEvent[];

  createdAt: Date;
  updatedAt: Date;
}

export interface Measurement {
  id: number;

  orderId: number;

  measurer: string;
  visitDate: Date;

  floorHeight?: number;
  staircaseWidth?: number;
  stepsCount?: number;

  comment?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface Payment {
  id: number;

  orderId: number;

  amount: number;

  method: string;
  type: string;

  comment?: string;

  createdAt: Date;
}

export interface Production {
  id: number;

  orderId: number;

  stage: string;
  percent: number;

  master: string;

  startDate?: Date | null;
  finishDate?: Date | null;

  comment?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface OrderEvent {
  id: number;

  orderId: number;

  title: string;
  description: string;

  user: string;

  createdAt: Date;
}

export interface Settings {
  id: number;

  pinePrice: number;
  elmPrice: number;
  oakPrice: number;

  woodRailing: number;
  glassRailing: number;
  brassRailing: number;

  ledPrice: number;
  paintingPrice: number;
  installationPrice: number;

  createdAt: Date;
  updatedAt: Date;
}

export type UserRole =
  | "DIRECTOR"
  | "MANAGER"
  | "ACCOUNTANT"
  | "PARTNER"
  | "PRODUCTION";

export interface User {
  id: number;

  name: string;
  email: string;

  role: UserRole;

  createdAt: Date;
  updatedAt: Date;
}

export interface FinanceReport {
  revenue: number;
  received: number;
  debt: number;
  partnerPaid: number;
  profit: number;
  averageOrder: number;
}

export interface ProductionReport {
  total: number;
  completed: number;
  inProgress: number;
}

export interface KPIReport {
  conversion: number;
  collectionRate: number;
  profitability: number;
}

export interface DirectorReport {
  generatedAt: Date;

  clients: number;
  orders: number;
  completedOrders: number;

  monthlyGoal: number;
  progress: number;

  finance: FinanceReport;

  production: ProductionReport;

  kpi: KPIReport;
}