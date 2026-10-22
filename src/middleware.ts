import { NextRequest, NextResponse } from "next/server";

const publicPaths = new Set(["/login", "/favicon.svg"]);

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.has(pathname) || pathname.startsWith("/_next/") || pathname.startsWith("/api/auth")) return NextResponse.next();
  if (!request.cookies.has("vessel-token")) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("returnTo", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
