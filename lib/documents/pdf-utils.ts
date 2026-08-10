import path from "node:path";

import PDFDocument from "pdfkit";

export const DOCUMENT_COLORS = {
  ink: "#171717",
  graphite: "#3F3F46",
  muted: "#71717A",
  gold: "#B68A3A",
  goldSoft: "#F6EFE2",
  paper: "#FFFFFF",
  neutral: "#F7F6F3",
  line: "#DEDAD2",
} as const;

export function registerDocumentFonts(document: PDFKit.PDFDocument) {
  const fontRoot = path.join(
    process.cwd(),
    "node_modules",
    "dejavu-fonts-ttf",
    "ttf",
  );
  document.registerFont("DejaVu", path.join(fontRoot, "DejaVuSans.ttf"));
  document.registerFont(
    "DejaVuBold",
    path.join(fontRoot, "DejaVuSans-Bold.ttf"),
  );
  document.registerFont(
    "DejaVuMono",
    path.join(fontRoot, "DejaVuSansMono.ttf"),
  );
}

export async function pdfBuffer(
  options: PDFKit.PDFDocumentOptions,
  draw: (document: PDFKit.PDFDocument) => void | Promise<void>,
) {
  const chunks: Buffer[] = [];
  const document = new PDFDocument({ ...options, compress: true });
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  registerDocumentFonts(document);
  await draw(document);
  document.end();
  return complete;
}

export function countPdfPages(bytes: Buffer) {
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return 0;
  const source = bytes.toString("latin1");
  return source.match(/\/Type\s*\/Page(?!s)\b/g)?.length ?? 0;
}

export async function streamToBuffer(stream: ReadableStream<Uint8Array>) {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

export function cleanPdfText(value: unknown, fallback = "Не указано") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}
