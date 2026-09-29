export const ATTACHMENT_PURPOSES = [
  { value: "CLIENT_SPACE", label: "Фото помещения клиента" },
  { value: "FRAME", label: "Фото каркаса / замера" },
  { value: "PAST_WORK", label: "Референс из наших работ" },
  { value: "DESIGN_RESULT", label: "Готовый 3D-проект" },
  { value: "GENERAL", label: "Другой файл" },
] as const;

export type AttachmentPurpose = (typeof ATTACHMENT_PURPOSES)[number]["value"];

export function isAttachmentPurpose(value: unknown): value is AttachmentPurpose {
  return ATTACHMENT_PURPOSES.some((item) => item.value === value);
}

export function attachmentPurposeLabel(value: string) {
  return ATTACHMENT_PURPOSES.find((item) => item.value === value)?.label ?? "Другой файл";
}

export type DesignPromptSource = {
  number: string;
  address: string;
  staircase: string;
  material: string;
  railingType: string;
  color: string;
  lighting: boolean;
  lightingDetails: string;
  cladding: boolean;
  claddingDetails: string;
  designStyle: string;
  designNotes: string;
};

export function buildDesignPrompt(
  source: DesignPromptSource,
  files: Array<{ fileName: string; purpose: string }>,
) {
  const namedFiles = (purpose: AttachmentPurpose) =>
    files.filter((file) => file.purpose === purpose).map((file) => file.fileName).join(", ") || "не приложены";
  return [
    `Подготовь фотореалистичный 3D-проект лестницы для заказа ${source.number}.`,
    "Используй приложенные фотографии помещения и каркаса как основу: сохрани геометрию, размеры, точки опоры, проёмы и перспективу. Не добавляй конструктивные элементы, которых нет в исходных данных.",
    `Объект: ${source.address || "адрес не указан"}.`,
    `Каркас: ${source.staircase || "не указан"}. Материал: ${source.material || "не указан"}.`,
    `Ограждение: ${source.railingType || "не указано"}. Цвет: ${source.color || "не указан"}.`,
    `Стиль: ${source.designStyle || "подбери нейтральный современный вариант"}.`,
    `Подсветка: ${source.lighting ? source.lightingDetails || "предусмотреть" : "не нужна"}.`,
    `Обшивка: ${source.cladding ? source.claddingDetails || "предусмотреть" : "не нужна"}.`,
    `Пожелания клиента: ${source.designNotes || "дополнений нет"}.`,
    `Фото помещения: ${namedFiles("CLIENT_SPACE")}.`,
    `Фото каркаса / замера: ${namedFiles("FRAME")}.`,
    `Референсы из наших работ: ${namedFiles("PAST_WORK")}.`,
    "Сначала кратко перечисли принятые решения, затем создай два ракурса одного и того же проекта. Если данных недостаточно, задай только самые необходимые уточняющие вопросы.",
  ].join("\n");
}
