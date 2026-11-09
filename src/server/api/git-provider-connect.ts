import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import {
  authenticatedUser,
  consumeGitProviderState,
  createGitProviderState,
  gitProviderRuntimeData,
  type GitProviderRuntime,
} from "@/lib/control-plane";
import { completeGitOAuth, verifyGitHubInstallation } from "@/lib/git-provider-clients";
import { gitProviderBaseUrl, isSecureGitProviderUrl } from "@/server/api/git-provider-url";

function admin(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return null;
  return user.role === "administrator" ? user : null;
}

function callbackBaseUrl(request: Request) {
  return gitProviderBaseUrl(request);
}

function callbackUrl(request: Request, id: string) {
  return `${callbackBaseUrl(request)}/api/git-providers/${encodeURIComponent(id)}/callback`;
}

function stateCookieName(id: string) {
  return `vessel-git-state-${id}`;
}

export function startGitProviderConnection(request: Request, id: string) {
  const user = admin(request);
  if (!user) return NextResponse.redirect(new URL("/login?returnTo=%2Fgit-providers", request.url));
  const provider = gitProviderRuntimeData(id);
  if (!provider) return NextResponse.redirect(new URL("/git-providers?error=not_found", request.url));
  try {
    const { state, verifier } = createGitProviderState(provider.id, user.id);
    const callback = callbackUrl(request, provider.id);
    const target = authorizationUrl(provider, callback, state, verifier);
    const response = NextResponse.redirect(target);
    response.cookies.set(stateCookieName(id), state, {
      httpOnly: true, secure: isSecureGitProviderUrl(callback), sameSite: "lax",
      path: "/api/git-providers/", maxAge: 600,
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch {
    return NextResponse.redirect(new URL("/git-providers?error=configuration", request.url));
  }
}

function authorizationUrl(provider: GitProviderRuntime, callback: string, state: string, verifier: string) {
  if (provider.provider === "github") {
    if (!provider.appSlug) throw new Error("GitHub App slug is required");
    const url = new URL(`https://github.com/apps/${encodeURIComponent(provider.appSlug)}/installations/new`);
    url.searchParams.set("state", state);
    return url;
  }
  const url = provider.provider === "gitlab"
    ? new URL(`${provider.baseUrl}/oauth/authorize`)
    : provider.provider === "bitbucket"
      ? new URL("https://bitbucket.org/site/oauth2/authorize")
      : new URL(`${provider.baseUrl}/login/oauth/authorize`);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", callback);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  if (provider.provider === "gitlab") {
    url.searchParams.set("scope", "read_api read_repository read_user");
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
  } else if (provider.provider === "bitbucket") {
    url.searchParams.set("scope", "repository account");
  } else {
    url.searchParams.set("scope", "read:user read:repository");
  }
  return url;
}

function redirectResult(request: Request, status: string) {
  const url = new URL("/git-providers", callbackBaseUrl(request));
  url.searchParams.set(status === "connected" ? "connected" : "error", status);
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function clearStateCookie(response: NextResponse, id: string) {
  const secure = process.env.NODE_ENV === "production" && Boolean(process.env.VESSEL_PUBLIC_URL?.startsWith("https://"));
  response.cookies.set(stateCookieName(id), "", {
    httpOnly: true, secure, sameSite: "lax",
    path: "/api/git-providers/", expires: new Date(0),
  });
  return response;
}

export async function finishGitProviderConnection(request: Request, id: string) {
  const user = admin(request);
  if (!user) return clearStateCookie(redirectResult(request, "unauthorized"), id);
  const provider = gitProviderRuntimeData(id);
  if (!provider) return clearStateCookie(redirectResult(request, "not_found"), id);
  const url = new URL(request.url);
  const cookieState = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${stateCookieName(id)}=`))?.slice(stateCookieName(id).length + 1);
  const returnedState = url.searchParams.get("state") ?? "";
  if (!cookieState || !returnedState || returnedState !== decodeURIComponent(cookieState)) return clearStateCookie(redirectResult(request, "invalid_state"), id);
  const verifier = consumeGitProviderState(returnedState, id, user.id);
  if (!verifier) return clearStateCookie(redirectResult(request, "invalid_state"), id);
  if (url.searchParams.has("error")) return clearStateCookie(redirectResult(request, "cancelled"), id);
  try {
    if (provider.provider === "github") {
      const installationId = url.searchParams.get("installation_id") ?? "";
      await verifyGitHubInstallation(provider, installationId);
    } else {
      const code = url.searchParams.get("code") ?? "";
      if (!code || code.length > 4096) throw new Error("OAuth code is missing or invalid");
      await completeGitOAuth(provider, code, verifier, callbackUrl(request, id));
    }
    return clearStateCookie(redirectResult(request, "connected"), id);
  } catch {
    return clearStateCookie(redirectResult(request, "authorization_failed"), id);
  }
}
