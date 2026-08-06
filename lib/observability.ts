type LogLevel = "info" | "warn" | "error";

function errorKind(error: unknown) {
  if (error instanceof Error) return error.name;
  return typeof error;
}

export function requestIdFrom(headers: Headers | Record<string, string | string[] | undefined>) {
  if (headers instanceof Headers) return headers.get("x-request-id") ?? undefined;
  const value = headers["x-request-id"];
  return Array.isArray(value) ? value[0] : value;
}

export function productionLog(level: LogLevel, event: string, fields: {
  requestId?: string;
  route?: string;
  method?: string;
  reason?: string;
  error?: unknown;
} = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...(fields.requestId ? { requestId: fields.requestId } : {}),
    ...(fields.route ? { route: fields.route } : {}),
    ...(fields.method ? { method: fields.method } : {}),
    ...(fields.reason ? { reason: fields.reason } : {}),
    ...(fields.error !== undefined ? { errorKind: errorKind(fields.error) } : {}),
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

export function logRequestFailure(event: string, request: Request, error: unknown) {
  productionLog("error", event, {
    requestId: request.headers.get("x-request-id") ?? undefined,
    route: new URL(request.url).pathname,
    method: request.method,
    error,
  });
}
