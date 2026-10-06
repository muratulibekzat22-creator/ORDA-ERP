import { readFile } from "node:fs/promises";
import path from "node:path";

import JSZip from "jszip";
import { NextResponse } from "next/server";

import { PRODUCT_CATALOG_REFERENCES } from "@/lib/design-catalog";
import { requirePermission } from "@/lib/server-auth";
import {
  getDesignCatalogContent,
  listDesignCatalogItems,
} from "@/lib/services/design-catalog.service";

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;

function safeName(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "photo";
}

function uniqueName(used: Set<string>, preferred: string) {
  const safe = safeName(preferred);
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : "";
  let candidate = safe;
  let counter = 2;
  while (used.has(candidate.toLocaleLowerCase("ru"))) {
    candidate = `${stem}-${counter}${extension}`;
    counter += 1;
  }
  used.add(candidate.toLocaleLowerCase("ru"));
  return candidate;
}

export async function GET() {
  const auth = await requirePermission("measurements");
  if (auth.response) return auth.response;

  const items = (await listDesignCatalogItems()).filter((item) =>
    item.contentType.startsWith("image/"),
  );
  const expectedBytes = items.reduce((sum, item) => sum + item.size, 0);
  if (expectedBytes > MAX_ARCHIVE_BYTES) {
    return NextResponse.json(
      {
        error:
          "Каталог больше 50 МБ. Скачайте нужные фотографии по отдельности.",
      },
      { status: 413 },
    );
  }

  const zip = new JSZip();
  const folder = zip.folder("ALTYN SAPA - каталоги изделий");
  if (!folder)
    return NextResponse.json(
      { error: "Не удалось подготовить архив" },
      { status: 500 },
    );

  const used = new Set<string>();
  for (const [index, reference] of PRODUCT_CATALOG_REFERENCES.entries()) {
    const referenceBytes = await readFile(
      path.join(process.cwd(), "public", ...reference.publicUrl.split("/").filter(Boolean)),
    );
    const prefix = reference.isReal ? "реальный-проект" : "пример-дизайна";
    folder.file(
      uniqueName(
        used,
        `${String(index + 1).padStart(2, "0")}-${prefix}-${reference.downloadFileName}`,
      ),
      referenceBytes,
    );
  }

  let added = 0;
  for (const item of items) {
    const source = await getDesignCatalogContent(item.id);
    if (!source) continue;
    const bytes = Buffer.from(await new Response(source.blob.stream).arrayBuffer());
    const order = safeName(item.order.number || "заказ");
    const staircase = safeName(item.order.staircase || "лестница");
    folder.file(
      uniqueName(used, `${order}-${staircase}-${item.fileName}`),
      bytes,
    );
    added += 1;
  }

  folder.file(
    "КАК ИСПОЛЬЗОВАТЬ.txt",
    [
      "ALTYN SAPA — каталоги изделий для работы с клиентом",
      "",
      "1. Откройте фотографии на телефоне или планшете и уточните, какой стиль нравится клиенту.",
      "2. Не обещайте точное повторение до замера и расчёта.",
      "3. Файл с пометкой «пример дизайна» является визуальным ориентиром, а не выполненным объектом.",
      `4. Подготовленных фотографий из утверждённых каталогов ALTYN SAPA: ${PRODUCT_CATALOG_REFERENCES.filter((item) => item.isReal).length}.`,
      `5. Дополнительных фотографий из заказов ORDA ERP: ${added}.`,
      "6. Внутри ORDA фотографии разделены на лестницы, двери и мебель.",
      "7. После выбора сохраните пожелания клиента в замере ORDA ERP.",
    ].join("\r\n"),
  );

  const bytes = await zip.generateAsync({
    type: "arraybuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Almaty",
  }).format(new Date());
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="ALTYN-SAPA-product-catalog-${date}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

