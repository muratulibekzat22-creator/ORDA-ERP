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
  productions?: Array<{
    stage: string;
    finishDate: Date | string | null;
  }>;
};

export const money = (value: NumericValue) => `${Number(value).toLocaleString("ru-RU")} ₸`;
export const date = (value: Date | string) => new Date(value).toLocaleDateString("ru-RU");
