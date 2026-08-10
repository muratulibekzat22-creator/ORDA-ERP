import { DocumentStatus, DocumentType } from "@prisma/client";

export const documentTypeLabels: Record<DocumentType, string> = {
  OFFER: "Коммерческое предложение",
  CONTRACT: "Договор",
  CUSTOMER_MEMO: "Памятка заказчику",
  ESTIMATE: "Смета",
  PROJECT: "Проект",
  MEASUREMENT_SHEET: "Замерный лист",
  ACT: "Акт",
  INVOICE: "Счёт",
  PAYMENT_RECEIPT: "Квитанция / подтверждение оплаты",
  PHOTO: "Фото / вложение",
  OTHER: "Другой документ",
};

export const documentStatusLabels: Record<DocumentStatus, string> = {
  [DocumentStatus.CANCELLED]: "Аннулирован",
  DRAFT: "Черновик",
  READY: "Готов",
  SIGNED: "Подписан",
  ARCHIVED: "Архив",
};

documentStatusLabels.CANCELLED = "Аннулирован";

export const documentTabs: Array<{ label: string; type: "" | DocumentType }> = [
  { label: "Все", type: "" },
  { label: "Договоры", type: DocumentType.CONTRACT },
  { label: "Памятки", type: DocumentType.CUSTOMER_MEMO },
  { label: "Сметы", type: DocumentType.ESTIMATE },
  { label: "Акты", type: DocumentType.ACT },
  { label: "Проекты", type: DocumentType.PROJECT },
  { label: "Замерные листы", type: DocumentType.MEASUREMENT_SHEET },
  { label: "Оплаты", type: DocumentType.PAYMENT_RECEIPT },
  { label: "Другие", type: DocumentType.OTHER },
];
