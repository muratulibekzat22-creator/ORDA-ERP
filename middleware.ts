import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/crm/:path*",
    "/clients/:path*",
    "/orders/:path*",
    "/production/:path*",
    "/finance/:path*",
    "/analytics/:path*",
    "/settings/:path*",
  ],
};