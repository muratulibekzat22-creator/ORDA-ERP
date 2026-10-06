import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "media-src 'self' blob:",
    "font-src 'self'",
    "connect-src 'self' https://*.blob.vercel-storage.com",
    "frame-src https://www.youtube.com https://www.youtube-nocookie.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  const incomingRequestId = request.headers.get("x-request-id") ?? "";
  const requestId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      incomingRequestId,
    )
      ? incomingRequestId
      : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  const next = () => {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("x-request-id", requestId);
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Access-Control-Allow-Origin", request.nextUrl.origin);
    if (process.env.ENABLE_HSTS === "true") response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
  };
  const redirect = (url: URL, status: 307 | 308 = 307) => {
    const response = NextResponse.redirect(url, status);
    response.headers.set("x-request-id", requestId);
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    if (process.env.ENABLE_HSTS === "true") response.headers.set("Strict-Transport-Security", "max-age=31536000");
    return response;
  };

  const requestHost = request.headers.get("host")?.split(":")[0]?.toLowerCase();
  if (
    process.env.VERCEL_ENV === "production" &&
    requestHost === "orda-erp-staging.vercel.app"
  ) {
    const canonicalUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, "https://erp.bekzatmuratuly.kz");
    return redirect(canonicalUrl, 308);
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method);
    const origin = request.headers.get("origin");
    if (mutation && origin) {
      const allowed = new Set([request.nextUrl.origin, process.env.NEXTAUTH_URL, "https://erp.bekzatmuratuly.kz"].filter(Boolean));
      if (!allowed.has(origin) && !/^https:\/\/orda-erp-staging(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin))
        return NextResponse.json({ error: "Недопустимый источник", code: "ORIGIN_FORBIDDEN", requestId }, { status: 403, headers: { "x-request-id": requestId, "Cache-Control": "no-store", "Content-Security-Policy": contentSecurityPolicy } });
    }
    const declaredLength = Number(request.headers.get("content-length") ?? 0);
    const uploadRoute = /\/(attachments|documents|statements)(\/|$)/.test(request.nextUrl.pathname);
    const offlineSyncRoute = request.nextUrl.pathname === "/api/offline/sync";
    const maximum = uploadRoute
      ? 110 * 1024 * 1024
      : offlineSyncRoute
        ? 6 * 1024 * 1024
        : 2 * 1024 * 1024;
    if (declaredLength > maximum)
      return NextResponse.json({ error: "Тело запроса слишком большое", code: "PAYLOAD_TOO_LARGE", requestId }, { status: 413, headers: { "x-request-id": requestId, "Cache-Control": "no-store" } });
    return next();
  }

  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/offline" ||
    request.nextUrl.pathname === "/manifest.webmanifest" ||
    request.nextUrl.pathname === "/sw.js"
  )
    return next();

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return redirect(url);
  }

  if (token.invalid) {
    const url = new URL("/login", request.url);
    url.searchParams.set("reason", "SESSION_INVALID");
    return redirect(url);
  }
  if (request.nextUrl.pathname.startsWith("/employee-handovers") && token.accountRole !== "DIRECTOR")
    return redirect(new URL("/", request.url));
  if (
    token.mustChangePassword &&
    request.nextUrl.pathname !== "/change-password"
  )
    return redirect(new URL("/change-password", request.url));
  if (!token.mustChangePassword && request.nextUrl.pathname === "/change-password")
    return redirect(new URL("/", request.url));

  const role = String(token.role ?? "");
  const permissions: Record<string, string[]> = {
    DIRECTOR: ["*"],
    OPERATIONS_DIRECTOR: ["clients", "orders", "measurements", "calendar", "documents", "production", "warehouse", "partners", "reports"],
    MARKETER: ["marketing", "calendar"],
    MANAGER: [
      "clients",
      "orders",
      "measurements",
      "calendar",
      "documents",
      "production",
      "warehouse",
      "partners",
    ],
    ACCOUNTANT: [
      "finance",
      "partners",
      "reports",
      "warehouse",
      "company-finance",
    ],
    MEASURER: ["measurements", "calendar"],
    DESIGNER: ["orders"],
    PRODUCTION: ["production", "calendar", "warehouse"],
    INSTALLER: ["production", "calendar", "warehouse"],
    PARTNER: ["partner", "orders"],
  };
  const firstSegment =
    request.nextUrl.pathname.split("/").filter(Boolean)[0] ?? "";
  if (
    role === "PARTNER" &&
    !["partner", "orders", "proposal", "change-password"].includes(firstSegment)
  )
    return redirect(new URL("/partner", request.url));
  const protectedSegment = [
    "clients",
    "orders",
    "measurements",
    "catalog",
    "calendar",
    "documents",
    "production",
    "warehouse",
    "finance",
    "partners",
    "reports",
    "analytics",
    "employees",
    "settings",
    "company-finance",
    "personal-finance",
    "calculator",
    "calculator-config",
    "partner",
    "payroll",
    "training",
    "marketing",
    "change-password",
  ].includes(firstSegment);
  if (
    firstSegment === "training" &&
    role !== "MEASURER" &&
    role !== "DIRECTOR" &&
    role !== "OPERATIONS_DIRECTOR"
  )
    return redirect(new URL("/", request.url));
  if (
    firstSegment === "calculator-config" &&
    role !== "DIRECTOR" &&
    role !== "ACCOUNTANT"
  )
    return redirect(new URL("/", request.url));
  const required =
    firstSegment === "catalog"
      ? "measurements"
      : firstSegment === "calculator"
      ? "orders"
      : firstSegment === "calculator-config"
        ? "*"
        : firstSegment === "analytics"
          ? "reports"
          : firstSegment;
  const allowed = permissions[role] ?? [];
  const selfPayroll = firstSegment === "payroll" && role !== "PARTNER" && role !== "OPERATIONS_DIRECTOR";
  const trainingWorkspace =
    firstSegment === "training" &&
    (role === "MEASURER" || role === "DIRECTOR" || role === "OPERATIONS_DIRECTOR");
  if (
    firstSegment !== "calculator-config" &&
    firstSegment !== "change-password" &&
    !selfPayroll &&
    !trainingWorkspace &&
    protectedSegment &&
    !allowed.includes("*") &&
    !allowed.includes(required)
  )
    return redirect(
      new URL(role === "PARTNER" ? "/partner" : "/", request.url),
    );

  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
