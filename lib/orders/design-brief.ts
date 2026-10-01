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

export type MeasurementDesignPromptSource = {
  measurementId: number;
  clientName: string;
  city: string;
  address: string;
  designStyle: string;
  designNotes: string;
};

const measurementPhotoLabels: Record<string, string> = {
  OBJECT_FRONT: "общий вид лестницы спереди",
  OBJECT_SIDE: "вид лестницы сбоку",
  OBJECT_REAR: "обратный ракурс и примыкания",
  OBJECT: "дополнительное фото объекта",
  DESIGN_REFERENCE: "желаемый дизайн клиента",
};

export function buildMeasurementDesignPrompt(
  source: MeasurementDesignPromptSource,
  files: Array<{ fileName: string; type: string }>,
) {
  const describedFiles = files
    .filter((file) => measurementPhotoLabels[file.type])
    .map((file) => `- ${measurementPhotoLabels[file.type]}: ${file.fileName}`)
    .join("\n");
  return [
    "Внимательно проанализируй все прикреплённые изображения и самостоятельно определи, где показан реальный объект или существующий каркас лестницы, а где — пример готового дизайна, который хочет клиент.",
    "",
    "Создай одну профессиональную, эстетичную и максимально фотореалистичную визуализацию готовой лестницы непосредственно в помещении клиента.",
    "",
    "Реальные фотографии используй как точную основу: сохрани помещение, ракурс, лестничный проём, расположение и количество ступеней, пропорции и конструкцию каркаса. Не изменяй реальную геометрию и не добавляй технически невозможные элементы.",
    "",
    "С фотографии желаемого дизайна возьми стиль, материал и цвет ступеней, подступенки, перила, поручень, стекло, латунь, дерево, декоративные элементы и общую эстетику. Не переноси помещение с фотографии-примера.",
    "",
    "Результат должен выглядеть дорого, гармонично и реалистично, как фотография уже изготовленной и установленной лестницы ALTYN SAPA. Обязательно добавь красивую скрытую тёплую LED-подсветку под каждой ступенью, если в пожеланиях не указано другое.",
    "",
    `Обезличенный объект: ${source.city || "город не указан"}. Замер № ${source.measurementId}. Не упоминай имя, телефон или точный адрес клиента.`,
    `Выбранный стиль: ${source.designStyle || "определи по референсу клиента"}.`,
    `Дополнительные пожелания клиента: ${source.designNotes || "нет"}. Эти пожелания учитывай в первую очередь.`,
    "",
    "Приложенные файлы:",
    describedFiles || "- файлы ещё не приложены",
    "",
    "Перед созданием проверь, что правильно понял реальный объект и желаемый дизайн. Если не хватает критически важной информации, задай все необходимые вопросы одним коротким сообщением. Если информации достаточно — сразу создавай визуализацию без лишних объяснений.",
    "",
    "Проверь результат: количество ступеней, геометрию, соединения перил, пропорции, материалы, освещение и отсутствие визуальных ошибок.",
    "",
    "Добавь аккуратный полупрозрачный водяной знак:",
    "ALTYN SAPA™️",
    "ТОВАРНЫЙ ЗНАК ALTYN SAPA COMPANY",
    "ЭСКИЗ № [САМОСТОЯТЕЛЬНО СОЗДАЙ СЛУЧАЙНЫЙ ШЕСТИЗНАЧНЫЙ НОМЕР]",
    "",
    "Внизу укажи:",
    "ALTYN SAPA COMPANY",
    "+7 708 575 08 81",
    "+7 776 002 75 55",
    "@altyn_sapa.company",
    "",
    "©️ 2026 ALTYN SAPA COMPANY.",
    "Индивидуальная визуализация. Пересылка третьим лицам, копирование, публикация и коммерческое использование без письменного разрешения ALTYN SAPA COMPANY запрещены.",
    "",
    "Все надписи и номера напиши точно, без ошибок.",
  ].join("\n");
}

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
