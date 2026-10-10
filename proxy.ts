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
    OPERATIONS_DIRECTOR: ["*"],
    MARKETER: ["marketing", "calendar", "warehouse", "brass"],
    MANAGER: [
      "clients",
      "orders",
      "measurements",
      "calendar",
      "documents",
      "production",
      "warehouse",
      "partners",
      "brass",
    ],
    ACCOUNTANT: [
      "partners",
      "reports",
      "warehouse",
      "brass",
    ],
    MEASURER: ["measurements", "calendar", "warehouse", "brass"],
    DESIGNER: ["orders", "warehouse", "brass"],
    PRODUCTION: ["production", "calendar", "warehouse", "brass"],
    INSTALLER: ["production", "calendar", "warehouse", "brass"],
    PARTNER: ["orders", "partners", "documents", "partner"],
  };
  const firstSegment =
    request.nextUrl.pathname.split("/").filter(Boolean)[0] ?? "";
  if (
    role === "OPERATIONS_DIRECTOR" &&
    ["reports", "analytics", "partners", "partner-management"].includes(firstSegment)
  )
    return redirect(new URL("/", request.url));
  if (role === "PARTNER" && firstSegment === "finance")
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
    "brass",
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
    role !== "OPERATIONS_DIRECTOR" &&
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
  const selfPayroll = firstSegment === "payroll" && role !== "PARTNER";
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
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico).*)"],
};
