export type NumericValue = string | number | { toString(): string };

export type DocumentOrder = {
  id: number;
  number: string;
  address: string;
  material: string;
  staircase: string;
  amount: NumericValue;
  prepayment: NumericValue;
  balance: NumericValue;
  createdAt: Date | string;
  client: {
    name: string;
    phone: string;
    city: string;
  };
  company?: {
    name: string;
    bin: string;
    legalAddress: string;
    actualAddress: string;
    phone: string;
    secondaryPhone: string;
    whatsapp: string;
    email: string;
    bankDetails: string;
    kaspiGoldName?: string;
    kaspiGoldPhone?: string;
    directorName: string;
    directorFullName?: string;
    iik?: string;
    bank?: string;
    bik?: string;
    logoUrl: string;
  } | null;
  calculations?: Array<{
    material: string;
    regularSteps: number;
    platformEquivalents: number[];
    equivalentSteps: number;
    clientPrice: NumericValue;
    createdAt: Date | string;
  }>;
  documents?: Array<{
    type: DocumentType;
    number: string;
    documentDate: Date | string;
  }>;
  productions?: Array<{
    stage: string;
    finishDate: Date | string | null;
  }>;
};

export const money = (value: NumericValue) =>
  `${Number(value).toLocaleString("ru-RU")} ₸`;
export const date = (value: Date | string) =>
  new Date(value).toLocaleDateString("ru-RU");
export const documentNumber = (
  order: DocumentOrder,
  type: "OFFER" | "CONTRACT" | "ACT" | "INVOICE",
) => {
  const savedNumber = order.documents?.find(
    (document) => document.type === type,
  )?.number;
  if (savedNumber) return savedNumber;
  if (type === "INVOICE") return `СЧ-${order.number}`;
  if (type === "OFFER") return `КП-${order.number}`;
  return order.number;
};
import type { DocumentType } from "@prisma/client";
