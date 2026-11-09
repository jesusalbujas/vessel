/**
 * Use the browser-visible origin by default, matching self-hosted Git provider
 * flows. VESSEL_PUBLIC_URL overrides it for reverse proxies or a different
 * external address. HTTP is supported for local and intranet deployments.
 */
export function gitProviderBaseUrl(request: Request): string {
  const configured = process.env.VESSEL_PUBLIC_URL?.trim().replace(/\/$/, "");
  const requestUrl = new URL(request.url);
  const originHeader = request.headers.get("origin")?.split(",")[0]?.trim();
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = request.headers.get("host")?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const originProtocol = originHeader ? (() => {
    try { return new URL(originHeader).protocol; } catch { return ""; }
  })() : "";
  const protocol = forwardedProto === "https" || forwardedProto === "http"
    ? `${forwardedProto}:`
    : originProtocol || requestUrl.protocol;
  const requestOrigin = originHeader || (forwardedHost || host
    ? `${protocol}//${forwardedHost || host}`
    : requestUrl.origin);
  const base = configured || requestOrigin;
  let url: URL;
  try { url = new URL(base); } catch { throw new Error("git_provider_public_url_invalid"); }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("git_provider_public_url_protocol");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("git_provider_public_url_origin_only");
  }
  return url.origin;
}

export function isSecureGitProviderUrl(value: string): boolean {
  return new URL(value).protocol === "https:";
}
