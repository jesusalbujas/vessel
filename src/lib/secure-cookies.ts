/**
 * Session cookies are Secure by default in production. Explicitly set
 * VESSEL_COOKIE_SECURE=false only when Vessel is intentionally served over
 * plain HTTP; use HTTPS for any internet-facing deployment.
 */
export function secureCookiesEnabled(): boolean {
  const configured = process.env.VESSEL_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
}
