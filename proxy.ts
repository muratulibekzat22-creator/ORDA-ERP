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
    "change-password",
  ].includes(firstSegment);
  if (
    firstSegment === "calculator-config" &&
    role !== "DIRECTOR" &&
    role !== "ACCOUNTANT"
  )
    return redirect(new URL("/", request.url));
  const required =
    firstSegment === "calculator"
      ? "orders"
      : firstSegment === "calculator-config"
        ? "*"
        : firstSegment === "analytics"
          ? "reports"
          : firstSegment;
  const allowed = permissions[role] ?? [];
  if (
    firstSegment !== "calculator-config" &&
    firstSegment !== "change-password" &&
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
