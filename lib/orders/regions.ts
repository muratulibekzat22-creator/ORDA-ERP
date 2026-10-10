export const ORDER_REGION_OPTIONS = [
  { key: "ALMATY_CITY", label: "Алматы" },
  { key: "ALMATY_REGION", label: "Алматинская область" },
  { key: "ASTANA_CITY", label: "Астана" },
  { key: "SHYMKENT_CITY", label: "Шымкент" },
  { key: "ABAI_REGION", label: "Абайская область" },
  { key: "AKMOLA_REGION", label: "Акмолинская область" },
  { key: "AKTOBE_REGION", label: "Актюбинская область" },
  { key: "ATYRAU_REGION", label: "Атырауская область" },
  { key: "EAST_KAZAKHSTAN_REGION", label: "Восточно-Казахстанская область" },
  { key: "JAMBYL_REGION", label: "Жамбылская область" },
  { key: "JETISU_REGION", label: "Жетысуская область" },
  { key: "WEST_KAZAKHSTAN_REGION", label: "Западно-Казахстанская область" },
  { key: "KARAGANDA_REGION", label: "Карагандинская область" },
  { key: "KOSTANAY_REGION", label: "Костанайская область" },
  { key: "KYZYLORDA_REGION", label: "Кызылординская область" },
  { key: "MANGYSTAU_REGION", label: "Мангистауская область" },
  { key: "PAVLODAR_REGION", label: "Павлодарская область" },
  { key: "NORTH_KAZAKHSTAN_REGION", label: "Северо-Казахстанская область" },
  { key: "TURKISTAN_REGION", label: "Туркестанская область" },
  { key: "ULYTAU_REGION", label: "Улытауская область" },
  { key: "UNSPECIFIED", label: "Регион не указан" },
] as const;

export type OrderRegionKey = (typeof ORDER_REGION_OPTIONS)[number]["key"];

const markers: Array<[OrderRegionKey, readonly string[]]> = [
  ["ALMATY_REGION", ["алматинская область", "алматы облысы", "almaty region", "almaty oblast", "каскелен", "қаскелең", "конаев", "қонаев", "капчагай", "талгар", "талғар", "туздыбастау", "есик", "есік", "боралдай", "отеген батыр", "өтеген батыр", "бесагаш", "бесағаш", "иргели", "іргелі"]],
  ["AKMOLA_REGION", ["акмолинская область", "ақмола облысы", "кокшетау", "көкшетау", "косшы", "қосшы", "степногорск"]],
  ["ABAI_REGION", ["абайская область", "абай облысы", "семей", "семипалатинск", "аксуат", "ақсуат"]],
  ["EAST_KAZAKHSTAN_REGION", ["восточно-казахстанская", "шығыс қазақстан", "өскемен", "усть-каменогорск", "риддер"]],
  ["KARAGANDA_REGION", ["карагандинская область", "қарағанды облысы", "караганда", "қарағанды", "темиртау", "теміртау"]],
  ["PAVLODAR_REGION", ["павлодарская область", "павлодар облысы", "павлодар", "экибастуз", "екібастұз"]],
  ["ULYTAU_REGION", ["улытауская область", "ұлытау облысы", "жезказган", "жезқазған", "сатпаев", "сәтбаев"]],
  ["JETISU_REGION", ["жетысуская область", "жетісу облысы", "талдыкорган", "талдықорған", "текели"]],
  ["JAMBYL_REGION", ["жамбылская область", "жамбыл облысы", "тараз"]],
  ["TURKISTAN_REGION", ["туркестанская область", "түркістан облысы", "туркестан", "түркістан", "кентау"]],
  ["KYZYLORDA_REGION", ["кызылординская область", "қызылорда облысы", "кызылорда", "қызылорда", "байконур", "байқоңыр"]],
  ["MANGYSTAU_REGION", ["мангистауская область", "маңғыстау облысы", "актау", "ақтау", "жанаозен", "жаңаөзен"]],
  ["ATYRAU_REGION", ["атырауская область", "атырау облысы", "атырау"]],
  ["WEST_KAZAKHSTAN_REGION", ["западно-казахстанская", "батыс қазақстан", "уральск", "орал"]],
  ["AKTOBE_REGION", ["актюбинская область", "ақтөбе облысы", "актобе", "ақтөбе"]],
  ["KOSTANAY_REGION", ["костанайская область", "қостанай облысы", "костанай", "қостанай", "рудный"]],
  ["NORTH_KAZAKHSTAN_REGION", ["северо-казахстанская", "солтүстік қазақстан", "петропавловск", "петропавл"]],
  ["ALMATY_CITY", ["алматы", "алма-ата", "almaty"]],
  ["ASTANA_CITY", ["астана", "нур-султан", "нұр-сұлтан", "astana"]],
  ["SHYMKENT_CITY", ["шымкент", "shymkent"]],
];

function normalizedLocation(value: string | null | undefined) {
  let normalized = (value ?? "").trim().toLocaleLowerCase("ru-RU");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep malformed legacy addresses searchable by their raw value.
  }
  return normalized;
}

export function orderRegionKey(city: string | null | undefined): OrderRegionKey {
  const normalized = normalizedLocation(city);
  for (const [key, aliases] of markers)
    if (aliases.some((alias) => normalized.includes(alias))) return key;
  return "UNSPECIFIED";
}

export function orderRegionLabel(key: OrderRegionKey) {
  return ORDER_REGION_OPTIONS.find((region) => region.key === key)?.label ?? "Регион не указан";
}

export function isOrderRegionKey(value: string): value is OrderRegionKey {
  return ORDER_REGION_OPTIONS.some((region) => region.key === value);
}
