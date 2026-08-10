type DateIdCursor = { at: Date; id: number };

export function encodeDateIdCursor(at: Date, id: number) {
  return Buffer.from(`${at.toISOString()}|${id}`, "utf8").toString("base64url");
}

export function decodeDateIdCursor(value?: string | null): DateIdCursor | null {
  if (!value || value.length > 256) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    const separator = decoded.lastIndexOf("|");
    if (separator <= 0) return null;
    const at = new Date(decoded.slice(0, separator));
    const id = Number(decoded.slice(separator + 1));
    return Number.isNaN(at.getTime()) || !Number.isInteger(id) || id <= 0
      ? null
      : { at, id };
  } catch {
    return null;
  }
}
