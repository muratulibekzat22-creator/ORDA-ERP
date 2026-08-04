export interface CompanyInfo {
    name: string;
    bin: string;
    phone: string;
    email: string;
    address: string;
  }
  
  export interface ClientInfo {
    name: string;
    phone: string;
    city: string;
    address: string;
  }
  
  export interface OrderInfo {
    number: string;
    staircase: string;
    material: string;
    amount: number;
    prepayment: number;
    balance: number;
  }
  
  export interface PDFData {
    company: CompanyInfo;
    client: ClientInfo;
    order: OrderInfo;
  }
  
  export function buildCommercialOffer(data: PDFData) {
    return {
      title: "Коммерческое предложение",
  
      company: data.company,
  
      client: data.client,
  
      order: data.order,
  
      createdAt: new Date(),
  
      rows: [
        {
          title: "Изготовление лестницы",
          value: data.order.amount,
        },
      ],
  
      total: data.order.amount,
    };
  }
  
  export function buildContract(data: PDFData) {
    return {
      title: "Договор",
  
      company: data.company,
  
      client: data.client,
  
      order: data.order,
  
      createdAt: new Date(),
  
      payment: {
        prepayment: data.order.prepayment,
        balance: data.order.balance,
      },
  
      guarantee: {
        pine: "Без гарантии",
        elm: "1 год",
        oak: "5 лет",
      },
    };
  }
  
  export function money(value: number) {
    return value.toLocaleString("ru-RU") + " ₸";
  }
  
  export function formatDate(date: Date) {
    return date.toLocaleDateString("ru-RU");
  }