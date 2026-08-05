import { getToken } from "next-auth/jwt";
import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    const url = new URL("/login", request.url);
    url.searchParams.set("callbackUrl", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

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
  const protectedSegment = [
    "clients",
    "orders",
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
  ].includes(firstSegment);
  if (
    firstSegment === "calculator-config" &&
    role !== "DIRECTOR" &&
    role !== "ACCOUNTANT"
  )
    return NextResponse.redirect(new URL("/", request.url));
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
    protectedSegment &&
    !allowed.includes("*") &&
    !allowed.includes(required)
  )
    return NextResponse.redirect(
      new URL(role === "PARTNER" ? "/partner" : "/", request.url),
    );

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|login|_next/static|_next/image|favicon.ico).*)"],
};
