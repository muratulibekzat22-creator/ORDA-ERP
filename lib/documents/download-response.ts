const INLINE_CONTENT_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function privateDocumentHeaders(
  file: { fileName: string; contentType: string; size: number },
  download: boolean,
) {
  const disposition = download || !INLINE_CONTENT_TYPES.has(file.contentType)
    ? "attachment"
    : "inline";
  return {
    "Content-Type": file.contentType,
    "Content-Length": String(file.size),
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
}
