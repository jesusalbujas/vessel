import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { consumeOAuthState, createOAuthState, createSession, endSession, getOAuthConfiguration, getPlatformSettings, resolveOAuthUser, sessionLifetimeSeconds, userCount } from "@/lib/control-plane";
import { secureCookiesEnabled } from "@/lib/secure-cookies";

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function loginRedirect(base: string, code: string): NextResponse {
  const destination = new URL("/login", base);
  destination.searchParams.set("oauth_error", code);
  return NextResponse.redirect(destination);
}

export async function startOAuth(request: Request) {
  if (process.env.NODE_ENV === "production" && (!process.env.VESSEL_SECRET_KEY || process.env.VESSEL_SECRET_KEY === "change-this-vessel-secret-key")) return loginRedirect(new URL(request.url).origin, "unavailable");
  const config = getOAuthConfiguration();
  if (userCount() === 0 || config.authMode !== "oauth" || !config.oauthUseSso || !config.oauthClientSecret) {
    return loginRedirect(new URL(request.url).origin, "unavailable");
  }

  const { state, verifier } = createOAuthState();
  const authorization = new URL(config.oauthAuthorizationUrl);
  authorization.searchParams.set("response_type", "code");
  authorization.searchParams.set("client_id", config.oauthClientId);
  authorization.searchParams.set("redirect_uri", config.oauthRedirectUrl);
  authorization.searchParams.set("scope", config.oauthScopes);
  authorization.searchParams.set("state", state);
  authorization.searchParams.set("code_challenge", pkceChallenge(verifier));
  authorization.searchParams.set("code_challenge_method", "S256");
  if (config.oauthProvider === "microsoft" || config.oauthProvider === "google") authorization.searchParams.set("prompt", "select_account");
  const response = NextResponse.redirect(authorization);
  response.cookies.set("vessel-oauth-state", state, { httpOnly: true, sameSite: "lax", secure: secureCookiesEnabled(), maxAge: 600, path: "/api/auth/oauth" });
  return response;
}

function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

function clearOAuthState(response: NextResponse): NextResponse {
  response.cookies.set("vessel-oauth-state", "", { httpOnly: true, sameSite: "lax", secure: secureCookiesEnabled(), expires: new Date(0), path: "/api/auth/oauth" });
  return response;
}

function claimValue(payload: unknown, path: string): unknown {
  let value: unknown = payload;
  for (const segment of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() || null : null;
}

async function exchangeCode(config: ReturnType<typeof getOAuthConfiguration>, code: string, verifier: string) {
  const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: config.oauthRedirectUrl, code_verifier: verifier });
  const makeRequest = (style: "post" | "basic") => {
    const body = new URLSearchParams(form);
    const headers = new Headers({ accept: "application/json", "content-type": "application/x-www-form-urlencoded" });
    if (style === "post") {
      body.set("client_id", config.oauthClientId);
      body.set("client_secret", config.oauthClientSecret);
    } else {
      headers.set("authorization", `Basic ${Buffer.from(`${config.oauthClientId}:${config.oauthClientSecret}`).toString("base64")}`);
    }
    return fetch(config.oauthTokenUrl, { method: "POST", headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
  };

  let response = await makeRequest(config.oauthAuthStyle === "basic" ? "basic" : "post");
  if (config.oauthAuthStyle === "auto" && (response.status === 400 || response.status === 401)) {
    const rejected = await response.clone().text().catch(() => "");
    if (/invalid_client|client authentication|unauthorized_client/i.test(rejected)) response = await makeRequest("basic");
  }
  if (!response.ok) throw new Error("OAuth token endpoint rejected the authorization code");
  const tokenData = await response.json() as { access_token?: unknown; id_token?: unknown; token_type?: unknown };
  if (typeof tokenData.access_token !== "string" || tokenData.access_token.length > 16384) throw new Error("OAuth token response is invalid");
  return { accessToken: tokenData.access_token, idToken: typeof tokenData.id_token === "string" && tokenData.id_token.length < 32768 ? tokenData.id_token : null };
}

async function getIdentity(config: ReturnType<typeof getOAuthConfiguration>, accessToken: string) {
  const response = await fetch(config.oauthResourceUrl, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json", "user-agent": "Vessel" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("OAuth user profile endpoint rejected the access token");
  const payload = await response.json() as Record<string, unknown>;
  const subject = stringValue(claimValue(payload, config.oauthUserIdentifier));
  if (!subject) throw new Error("OAuth profile does not contain the configured user identifier");
  let email = stringValue(payload.email);
  let emailVerified = payload.email_verified === true || payload.email_verified === "true";

  if (config.oauthProvider === "github" && (!email || !emailVerified || !config.oauthAutoProvision)) {
    const emailsResponse = await fetch("https://api.github.com/user/emails", {
      headers: { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "Vessel" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000),
    });
    if (emailsResponse.ok) {
      const addresses = await emailsResponse.json() as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>;
      const primary = addresses.find((item) => item.primary === true && item.verified === true);
      if (primary) { email = stringValue(primary.email); emailVerified = Boolean(email); }
    }
  }

  const username = stringValue(payload.preferred_username) ?? stringValue(payload.login) ?? stringValue(payload.username) ?? stringValue(payload.name) ?? email?.split("@")[0] ?? subject;
  return { subject, email, emailVerified, username };
}

export async function callbackOAuth(request: Request) {
  const callbackRequestUrl = new URL(request.url);
  if (process.env.NODE_ENV === "production" && (!process.env.VESSEL_SECRET_KEY || process.env.VESSEL_SECRET_KEY === "change-this-vessel-secret-key")) return loginRedirect(callbackRequestUrl.origin, "unavailable");
  const config = getOAuthConfiguration();
  const requestUrl = callbackRequestUrl;
  const state = requestUrl.searchParams.get("state") ?? "";
  const browserState = cookieValue(request, "vessel-oauth-state");
  const fallbackBase = config.oauthRedirectUrl ? new URL(config.oauthRedirectUrl).origin : requestUrl.origin;
  if (!state || !browserState || state !== browserState) return clearOAuthState(loginRedirect(fallbackBase, "invalid_state"));
  const verifier = consumeOAuthState(state);
  if (!verifier) return clearOAuthState(loginRedirect(fallbackBase, "invalid_state"));
  if (requestUrl.searchParams.has("error")) return clearOAuthState(loginRedirect(fallbackBase, "cancelled"));
  const code = requestUrl.searchParams.get("code");
  if (!code || code.length > 4096 || config.authMode !== "oauth" || !config.oauthUseSso) return clearOAuthState(loginRedirect(fallbackBase, "unavailable"));

  try {
    const tokens = await exchangeCode(config, code, verifier);
    const identity = await getIdentity(config, tokens.accessToken);
    if (!config.oauthAutoProvision && !identity.emailVerified) throw new Error("The provider must return a verified email when automatic provisioning is disabled");
    const user = resolveOAuthUser({ provider: config.oauthProvider, subject: identity.subject, email: identity.email, emailVerified: identity.emailVerified, username: identity.username, autoProvision: config.oauthAutoProvision });
    const session = createSession(user.id, tokens.idToken, request);
    const response = NextResponse.redirect(new URL("/", fallbackBase));
    response.cookies.set("vessel-token", session, { httpOnly: true, sameSite: "lax", secure: secureCookiesEnabled(), maxAge: sessionLifetimeSeconds(), path: "/" });
    return clearOAuthState(response);
  } catch {
    return clearOAuthState(loginRedirect(fallbackBase, "failed"));
  }
}

export async function logoutOAuth(request: Request) {
  const requestUrl = new URL(request.url);
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-token="));
  const sessionToken = bearer || (cookie ? decodeURIComponent(cookie.slice("vessel-token=".length)) : "");
  const idToken = sessionToken ? endSession(sessionToken) : null;
  const config = getPlatformSettings();
  const destination = config.oauthLogoutUrl ? new URL(config.oauthLogoutUrl) : null;
  if (destination) {
    if (idToken) destination.searchParams.set("id_token_hint", idToken);
    destination.searchParams.set("post_logout_redirect_uri", new URL("/login", config.oauthRedirectUrl || requestUrl.origin).toString());
    if (config.oauthClientId) destination.searchParams.set("client_id", config.oauthClientId);
  }
  // Keep local/self-hosted sign-out on the browser's current origin. The
  // internal request URL can contain Docker's container hostname.
  const response = destination
    ? NextResponse.redirect(destination)
    : new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  response.cookies.set("vessel-token", "", { httpOnly: true, expires: new Date(0), path: "/", sameSite: "lax", secure: secureCookiesEnabled() });
  return response;
}
