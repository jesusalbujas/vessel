import { NextResponse } from "next/server";
import {
  authenticatedUser,
  deleteGitProvider,
  disconnectGitProvider,
  gitProviderById,
  listGitProviders,
  saveGitProvider,
  secretStorageReady,
  type GitProviderKind,
} from "@/lib/control-plane";
import { gitProviderBaseUrl } from "@/server/api/git-provider-url";

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}

function admin(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return { response: privateJson({ error: "Authentication required" }, { status: 401 }) };
  if (user.role !== "administrator") return { response: privateJson({ error: "Administrator access required" }, { status: 403 }) };
  return { user };
}

export function getGitProviders(request: Request) {
  const auth = admin(request);
  if ("response" in auth) return auth.response;
  let baseUrl: string;
  let callbackBaseUrlError: string | null = null;
  try { baseUrl = gitProviderBaseUrl(request); }
  catch (error) {
    // Keep provider and secret-storage status available when only the callback URL needs attention.
    baseUrl = new URL(request.url).origin;
    callbackBaseUrlError = error instanceof Error ? error.message : "git_provider_public_url_invalid";
  }
  return privateJson({
    data: listGitProviders(), secretStorageReady: secretStorageReady(),
    callbackBaseUrl: baseUrl, callbackBaseUrlError,
  });
}

export async function postGitProviders(request: Request) {
  const auth = admin(request);
  if ("response" in auth) return auth.response;
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 48_000) return privateJson({ error: "Request is too large" }, { status: 413 });
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || JSON.stringify(body).length > 48_000) return privateJson({ error: "Invalid or oversized request" }, { status: 400 });
  try {
    if (body.action === "save") {
      const provider = body.provider;
      if (!["github", "gitlab", "bitbucket", "gitea"].includes(String(provider))) return privateJson({ error: "Unsupported Git provider" }, { status: 400 });
      const saved = saveGitProvider({
        id: typeof body.id === "string" ? body.id : undefined,
        provider: provider as GitProviderKind,
        name: typeof body.name === "string" ? body.name : "",
        baseUrl: typeof body.baseUrl === "string" ? body.baseUrl : "",
        clientId: typeof body.clientId === "string" ? body.clientId : "",
        clientSecret: typeof body.clientSecret === "string" ? body.clientSecret : undefined,
        appId: typeof body.appId === "string" ? body.appId : undefined,
        appSlug: typeof body.appSlug === "string" ? body.appSlug : undefined,
        appPrivateKey: typeof body.appPrivateKey === "string" ? body.appPrivateKey : undefined,
        webhookSecret: typeof body.webhookSecret === "string" ? body.webhookSecret : undefined,
        shareWithOrganization: body.shareWithOrganization !== false,
        createdBy: auth.user.id,
      });
      return privateJson({ data: saved }, { status: body.id ? 200 : 201 });
    }
    if (body.action === "disconnect") {
      if (typeof body.id !== "string" || !gitProviderById(body.id)) return privateJson({ error: "Git provider not found" }, { status: 404 });
      disconnectGitProvider(body.id);
      return privateJson({ ok: true });
    }
    return privateJson({ error: "Unsupported action" }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save Git provider";
    return privateJson({ error: message }, { status: message.includes("UNIQUE constraint failed") ? 409 : 400 });
  }
}

export function deleteGitProviderRequest(request: Request) {
  const auth = admin(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !gitProviderById(id)) return privateJson({ error: "Git provider not found" }, { status: 404 });
  try {
    deleteGitProvider(id);
    return privateJson({ ok: true });
  } catch (error) {
    return privateJson({ error: error instanceof Error ? error.message : "Could not remove provider" }, { status: 409 });
  }
}
