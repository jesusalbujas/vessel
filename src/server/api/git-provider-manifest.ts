import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  authenticatedUser,
  consumeGitManifestState,
  consumeGitProviderState,
  createGitManifestState,
  gitProviderRuntimeData,
  gitProviderStateOwner,
  saveGitProvider,
  secretStorageReady,
} from "@/lib/control-plane";
import { verifyGitHubInstallation } from "@/lib/git-provider-clients";
import { gitProviderBaseUrl, isSecureGitProviderUrl } from "@/server/api/git-provider-url";

const manifestCookie = "vessel-github-manifest-state";
const setupCookiePrefix = "vessel-git-state-";

function admin(request: Request) {
  const user = authenticatedUser(request);
  return user?.role === "administrator" ? user : null;
}

function cookieValue(request: Request, name: string) {
  const raw = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
  if (!raw) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
}

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}

function redirectToProviders(request: Request, query: Record<string, string>, clearCookie?: { name: string; path: string; secure: boolean }, browserOrigin?: string) {
  let baseUrl: string;
  try { baseUrl = browserOrigin ?? gitProviderBaseUrl(request); } catch { baseUrl = new URL(request.url).origin; }
  const destination = new URL("/git-providers", baseUrl);
  for (const [key, value] of Object.entries(query)) destination.searchParams.set(key, value);
  const response = NextResponse.redirect(destination);
  response.headers.set("Cache-Control", "no-store");
  if (clearCookie) response.cookies.set(clearCookie.name, "", {
    httpOnly: true, secure: clearCookie.secure, sameSite: "lax", path: clearCookie.path, expires: new Date(0),
  });
  return response;
}

export async function startGitHubManifest(request: Request) {
  const user = admin(request);
  if (!user) return privateJson({ error: "Administrator access required" }, { status: 403 });
  if (!secretStorageReady()) return privateJson({ error: "git_provider_secret_storage_required" }, { status: 503 });
  const body = await request.json().catch(() => ({})) as { organization?: unknown };
  const organization = typeof body.organization === "string" ? body.organization.trim() : "";
  if (organization && !/^(?=.{1,39}$)[a-z\d](?:[a-z\d]|-(?=[a-z\d]))*$/i.test(organization)) {
    return privateJson({ error: "git_provider_github_organization_invalid" }, { status: 400 });
  }
  let baseUrl: string;
  try { baseUrl = gitProviderBaseUrl(request); }
  catch (error) { return privateJson({ error: error instanceof Error ? error.message : "git_provider_public_url_invalid" }, { status: 503 }); }

  const state = createGitManifestState(user.id, baseUrl, 60 * 60 * 1000);
  const callback = `${baseUrl}/api/git-providers/github/manifest/callback`;
  const setup = `${baseUrl}/api/git-providers/github/setup`;
  const webhook = `${baseUrl}/api/webhooks/git`;
  const suffix = randomUUID().slice(0, 6);
  const manifest = {
    name: `Vessel Deployments ${suffix}`,
    url: baseUrl,
    hook_attributes: { url: webhook, active: true },
    redirect_url: callback,
    setup_url: setup,
    description: "Read-only repository access for deployments managed by Vessel.",
    public: true,
    default_permissions: { contents: "read", metadata: "read" },
    default_events: ["push", "release"],
  };
  const appRegistrationUrl = organization
    ? new URL(`https://github.com/organizations/${encodeURIComponent(organization)}/settings/apps/new`)
    : new URL("https://github.com/settings/apps/new");
  appRegistrationUrl.searchParams.set("state", state);
  const response = privateJson({
    actionUrl: appRegistrationUrl.toString(),
    manifest,
  });
  response.cookies.set(manifestCookie, state, {
    httpOnly: true, secure: isSecureGitProviderUrl(baseUrl), sameSite: "lax",
    path: "/api/git-providers/github/manifest/callback", maxAge: 3600,
  });
  return response;
}

type GitHubManifestApp = {
  id?: number;
  slug?: string;
  name?: string;
  client_id?: string;
  client_secret?: string;
  pem?: string;
  webhook_secret?: string;
};

export async function finishGitHubManifest(request: Request) {
  const user = admin(request);
  if (!user) return redirectToProviders(request, { error: "manifest_login_required" });
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  const savedState = cookieValue(request, manifestCookie);
  const browserOrigin = state && savedState && state === savedState ? consumeGitManifestState(state, user.id) : null;
  if (!browserOrigin) {
    return redirectToProviders(request, { error: "manifest_invalid_state" });
  }
  const clear = { name: manifestCookie, path: "/api/git-providers/github/manifest/callback", secure: isSecureGitProviderUrl(browserOrigin) };
  if (url.searchParams.has("error") || !code || code.length > 512) {
    return redirectToProviders(request, { error: "manifest_cancelled" }, clear, browserOrigin);
  }

  try {
    const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000),
      headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "Vessel-Git-Providers" },
    });
    if (!response.ok) throw new Error("GitHub rechazó la creación de la aplicación");
    const app = await response.json() as GitHubManifestApp;
    const appId = app.id ? String(app.id) : "";
    const appSlug = app.slug ?? "";
    if (!/^\d{1,20}$/.test(appId) || !/^[A-Za-z0-9-]{1,100}$/.test(appSlug) || !app.client_id || !app.client_secret || !app.pem?.includes("PRIVATE KEY") || !app.webhook_secret) {
      throw new Error("GitHub devolvió una configuración de aplicación incompleta");
    }
    const connection = saveGitProvider({
      provider: "github", name: `GitHub ${appSlug}`.slice(0, 64), baseUrl: "https://github.com",
      clientId: app.client_id, clientSecret: app.client_secret, appId, appSlug, appPrivateKey: app.pem,
      webhookSecret: app.webhook_secret,
      shareWithOrganization: true, createdBy: user.id,
    });
    return redirectToProviders(request, { action_required: connection.id }, clear, browserOrigin);
  } catch {
    return redirectToProviders(request, { error: "manifest_create_failed" }, clear, browserOrigin);
  }
}

export async function finishGitHubSetup(request: Request) {
  const user = admin(request);
  if (!user) return redirectToProviders(request, { error: "manifest_login_required" });
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const installationId = url.searchParams.get("installation_id") ?? "";
  const providerId = gitProviderStateOwner(state, user.id);
  if (!providerId) return redirectToProviders(request, { error: "manifest_invalid_state" });
  const cookieName = `${setupCookiePrefix}${providerId}`;
  const savedState = cookieValue(request, cookieName);
  let baseUrl: string;
  try { baseUrl = gitProviderBaseUrl(request); } catch { baseUrl = url.origin; }
  const clear = { name: cookieName, path: "/api/git-providers/", secure: isSecureGitProviderUrl(baseUrl) };
  if (!savedState || savedState !== state || !installationId || installationId.length > 20) {
    return redirectToProviders(request, { error: "manifest_install_failed" }, clear);
  }
  const verifier = consumeGitProviderState(state, providerId, user.id);
  if (!verifier) return redirectToProviders(request, { error: "manifest_invalid_state" }, clear);
  try {
    const provider = gitProviderRuntimeData(providerId);
    if (!provider || provider.provider !== "github") throw new Error("GitHub provider not found");
    await verifyGitHubInstallation(provider, installationId);
    return redirectToProviders(request, { connected: "connected" }, clear);
  } catch {
    return redirectToProviders(request, { error: "manifest_install_failed" }, clear);
  }
}
