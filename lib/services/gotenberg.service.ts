const MAX_PDF_BYTES = 25 * 1024 * 1024;
const CONVERSION_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

export class GotenbergError extends Error {
  constructor(code: string) {
    super(code);
    this.name = "GotenbergError";
  }
}

function settings() {
  const url = process.env.GOTENBERG_URL?.trim().replace(/\/+$/, "");
  const token = process.env.GOTENBERG_TOKEN?.trim();
  if (!url || !token) throw new GotenbergError("CONVERTER_NOT_CONFIGURED");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GotenbergError("CONVERTER_URL_INVALID");
  }
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new GotenbergError("CONVERTER_URL_INVALID");
  return { url, token };
}

function retryable(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof GotenbergError &&
      ["CONVERTER_TIMEOUT", "CONVERTER_UNAVAILABLE"].includes(error.message))
  );
}

export async function convertDocxToPdf(input: {
  bytes: Buffer;
  fileName: string;
}) {
  const { url, token } = settings();
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONVERSION_TIMEOUT_MS);
    try {
      const form = new FormData();
      form.set(
        "files",
        new Blob([new Uint8Array(input.bytes)], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        input.fileName,
      );
      const response = await fetch(`${url}/forms/libreoffice/convert`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        if (response.status >= 500)
          throw new GotenbergError("CONVERTER_UNAVAILABLE");
        throw new GotenbergError("CONVERTER_REJECTED_DOCUMENT");
      }
      const length = Number(response.headers.get("content-length") ?? 0);
      if (length > MAX_PDF_BYTES) throw new GotenbergError("PDF_TOO_LARGE");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (
        bytes.length <= 5 ||
        bytes.length > MAX_PDF_BYTES ||
        bytes.subarray(0, 5).toString("ascii") !== "%PDF-"
      )
        throw new GotenbergError("INVALID_PDF_RESPONSE");
      return bytes;
    } catch (error) {
      lastError =
        error instanceof DOMException && error.name === "AbortError"
          ? new GotenbergError("CONVERTER_TIMEOUT")
          : error;
      if (!retryable(lastError) || attempt === MAX_ATTEMPTS - 1) throw lastError;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}
