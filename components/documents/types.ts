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
    whatsapp: string;
    email: string;
    bankDetails: string;
    directorName: string;
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
export const documentNumber = (order: DocumentOrder, type: "OFFER" | "CONTRACT" | "ACT" | "INVOICE") => order.documents?.find((document) => document.type === type)?.number ?? order.number;
import type { DocumentType } from "@prisma/client";
