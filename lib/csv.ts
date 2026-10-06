export function spreadsheetSafeText(value: unknown) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[\r\n]+/g, " ");
  const candidate = normalized.trimStart();
  return /^[=+\-@]/.test(candidate) || /^[\t\r\n]/.test(String(value ?? ""))
    ? `'${normalized}`
    : normalized;
}

export function csvCell(value: unknown) {
  return `"${spreadsheetSafeText(value).replaceAll('"', '""')}"`;
}

export function csvDocument(rows: unknown[][]) {
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}
