import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const incomingRequestId = request.headers.get("x-request-id") ?? "";
  const requestId =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      incomingRequestId,
    )
      ? incomingRequestId
      : crypto.randomUUID();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", requestId);
  const next = () => {
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("x-request-id", requestId);
    return response;
  };
  const redirect = (url: URL) => {
    const response = NextResponse.redirect(url);
    response.headers.set("x-request-id", requestId);
    return response;
  };
  const rewrite = (url: URL) => {
    const response = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
    response.headers.set("x-request-id", requestId);
    return response;
  };

  if (request.nextUrl.pathname.startsWith("/api/")) return next();

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
  if (String(token.role ?? "") === "OPERATIONS_DIRECTOR") {
    const expiresAt = typeof token.accessExpiresAt === "string"
      ? new Date(token.accessExpiresAt)
      : null;
    const reason = token.accessRevokedAt || token.temporaryAccess !== true
      ? "OPERATIONAL_ACCESS_REVOKED"
      : !expiresAt || expiresAt <= new Date()
        ? "TEMPORARY_ACCESS_EXPIRED"
        : null;
    if (reason) {
      const url = new URL("/login", request.url);
      url.searchParams.set("reason", reason);
      return redirect(url);
    }
  }
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
    OPERATIONS_DIRECTOR: ["clients", "orders", "measurements", "calendar", "documents", "production", "warehouse", "partners", "reports", "marketing", "operations"],
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
    PARTNER: ["orders", "finance", "partners", "documents", "partner"],
  };
  const firstSegment =
    request.nextUrl.pathname.split("/").filter(Boolean)[0] ?? "";
  if (
    role === "OPERATIONS_DIRECTOR" &&
    firstSegment !== "operations" &&
    token.companyOperationsEnabled !== true
  )
    return redirect(new URL("/operations", request.url));
  if (role === "MARKETER" && /^\/clients\/\d+$/.test(request.nextUrl.pathname)) {
    const id = request.nextUrl.pathname.split("/").at(-1);
    return rewrite(new URL(`/marketing/applications/${id}`, request.url));
  }
  if (role === "PARTNER" && firstSegment === "finance")
    return redirect(new URL("/partner", request.url));
  const protectedSegment = [
    "clients",
    "orders",
    "measurements",
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
    "change-password",
    "marketing",
    "operations",
    "partner-management",
  ].includes(firstSegment);
  if (firstSegment === "marketing" && role !== "DIRECTOR" && role !== "OPERATIONS_DIRECTOR" && role !== "MARKETER")
    return new NextResponse("Доступ запрещён", { status: 403, headers: { "x-request-id": requestId } });
  if (
    firstSegment === "training" &&
    role !== "MEASURER" &&
    role !== "DIRECTOR"
  )
    return redirect(new URL("/", request.url));
  if (
    firstSegment === "calculator-config" &&
    role !== "DIRECTOR" &&
    role !== "ACCOUNTANT"
  )
    return redirect(new URL("/", request.url));
  const required =
    firstSegment === "calculator"
      ? "orders"
      : firstSegment === "partner-management"
        ? "partners"
      : firstSegment === "calculator-config"
        ? "*"
        : firstSegment === "analytics"
          ? "reports"
          : firstSegment;
  const allowed = permissions[role] ?? [];
  const selfPayroll = firstSegment === "payroll" && role !== "PARTNER" && role !== "OPERATIONS_DIRECTOR";
  const trainingWorkspace =
    firstSegment === "training" &&
    (role === "MEASURER" || role === "DIRECTOR");
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
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
