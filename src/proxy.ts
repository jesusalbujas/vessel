import { NextRequest, NextResponse } from "next/server";

const publicPaths = new Set(["/login", "/favicon.svg", "/fonts/outfit-latin.woff2"]);

function makeNonce() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPage = !pathname.startsWith("/api/") && !pathname.startsWith("/_next/");
  const nonce = isPage ? makeNonce() : "";
  const reportOnlyCsp = nonce
    ? `default-src 'self'; img-src 'self' data: https://gravatar.com https://*.gravatar.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https:`
    : "";
  const addSecurityHeaders = (response: NextResponse) => {
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    response.headers.set("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https://gravatar.com https://*.gravatar.com; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https:");
    if (reportOnlyCsp) response.headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp);
    try {
      if (process.env.VESSEL_PUBLIC_URL && new URL(process.env.VESSEL_PUBLIC_URL).protocol === "https:") response.headers.set("Strict-Transport-Security", "max-age=15552000");
    } catch { /* Invalid public URL is handled by the corresponding configuration flow. */ }
    return response;
  };
  const continueRequest = () => {
    if (!nonce) return addSecurityHeaders(NextResponse.next());
    // Next reads the request CSP to add the nonce to framework-generated scripts.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", reportOnlyCsp);
    requestHeaders.set("Content-Security-Policy-Report-Only", reportOnlyCsp);
    requestHeaders.set("x-nonce", nonce);
    return addSecurityHeaders(NextResponse.next({ request: { headers: requestHeaders } }));
  };
  const isWebhook = pathname.startsWith("/api/webhooks/");
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  const hasBearer = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (isMutation && !isWebhook && Number.isFinite(contentLength) && contentLength > 8 * 1024 * 1024) {
    return addSecurityHeaders(NextResponse.json({ error: "Request body exceeds the 8 MiB limit" }, { status: 413, headers: { "Cache-Control": "private, no-store" } }));
  }
  if (isMutation && !isWebhook && !hasBearer) {
    const allowedOrigins = new Set([request.nextUrl.origin]);
    // Next's parsed URL can reflect an internal proxy/container address while
    // the browser sends the public Host. Accept the origin reconstructed from
    // that request authority (and the proxy's forwarded scheme) as well.
    const requestHost = request.headers.get("host")?.split(",")[0]?.trim();
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const requestProtocol = forwardedProtocol || request.nextUrl.protocol.replace(/:$/, "");
    if (requestHost && (requestProtocol === "http" || requestProtocol === "https")) {
      try { allowedOrigins.add(new URL(`${requestProtocol}://${requestHost}`).origin); } catch { /* Ignore malformed Host headers. */ }
    }
    try {
      const configuredOrigin = process.env.VESSEL_PUBLIC_URL?.trim();
      if (configuredOrigin) allowedOrigins.add(new URL(configuredOrigin).origin);
    } catch { /* Fall back to the request origin when the public URL is invalid. */ }
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    let sourceOrigin = origin;
    if (!sourceOrigin && referer) {
      try { sourceOrigin = new URL(referer).origin; } catch { sourceOrigin = null; }
    }
    if (!sourceOrigin || !allowedOrigins.has(sourceOrigin) || request.headers.get("sec-fetch-site") === "cross-site") {
      return addSecurityHeaders(NextResponse.json({ error: "Cross-origin request denied" }, { status: 403, headers: { "Cache-Control": "private, no-store", Vary: "Origin, Cookie" } }));
    }
  }
  if (publicPaths.has(pathname) || pathname.startsWith("/_next/") || pathname.startsWith("/api/auth")) return continueRequest();
  if (isWebhook) return continueRequest();
  if (/^\/api\/git-providers\/[^/]+\/(callback|connect)$/.test(pathname)) return continueRequest();
  if (!request.cookies.has("vessel-token")) {
    if (pathname.startsWith("/api/")) {
      return addSecurityHeaders(NextResponse.json(
        { error: "Authentication required" },
        { status: 401, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } },
      ));
    }
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("returnTo", pathname);
    return addSecurityHeaders(NextResponse.redirect(login));
  }
  return continueRequest();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
