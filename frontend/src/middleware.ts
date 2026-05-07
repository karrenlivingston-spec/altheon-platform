import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Canonical public path list — use with `isPublicRoute()` when adding auth middleware.
 */
export const PUBLIC_ROUTE_PATHS = ["/", "/intake", "/admin/login"] as const;

export const PUBLIC_ROUTES = new Set<string>(PUBLIC_ROUTE_PATHS);

/** Path prefixes treated as public (e.g. /intake/step ). */
export const PUBLIC_ROUTE_PREFIXES = ["/intake"] as const;

export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.has(pathname)) return true;
  for (const prefix of PUBLIC_ROUTE_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
