import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { authenticate, createInitialAdmin, createSession, currentUser, ensureInitialAdmin, getPlatformSettings, passwordPolicy, requestTokenFromRequest, revokeSession, sessionLifetimeSeconds, updateUserEmail, userCount } from "@/lib/control-plane";
import { clearLoginFailures, loginRetryAfterSeconds, recordLoginFailure } from "@/lib/login-rate-limit";

const token = requestTokenFromRequest;
function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}
export async function getAuth(request: Request) {
  ensureInitialAdmin();
  const settings = getPlatformSettings();
  const setupRequired = userCount() === 0;
  return privateJson({
    user: currentUser(token(request)),
    setupRequired,
    passwordPolicy: passwordPolicy(),
    authentication: {
      mode: settings.authMode,
      oauthLoginEnabled: !setupRequired && settings.authMode === "oauth" && settings.oauthUseSso && settings.oauthClientSecretConfigured && Boolean(settings.oauthClientId && settings.oauthAuthorizationUrl && settings.oauthTokenUrl && settings.oauthResourceUrl && settings.oauthRedirectUrl) && (process.env.NODE_ENV !== "production" || Boolean(process.env.VESSEL_SECRET_KEY && process.env.VESSEL_SECRET_KEY !== "change-this-vessel-secret-key")),
      oauthProvider: settings.oauthProvider,
      hideInternalPrompt: settings.oauthHideInternalPrompt,
    },
  });
}
export async function postAuth(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return privateJson({ error: "Request is too large" }, { status: 413 });
  const body = await request.json().catch(() => null) as { action?: "login" | "setup"; username?: string; password?: string } | null;
  if (body?.action === "setup") {
    try {
      const user = createInitialAdmin(body.username ?? "", body.password ?? "");
      const session = createSession(user.id, null, request); const response = privateJson({ user, setupCompleted: true }, { status: 201 });
      response.cookies.set("vessel-token", session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: sessionLifetimeSeconds(), path: "/" }); return response;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create administrator" }, { status: 400 });
    }
  }
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  if (username.length > 64 || password.length > 1024) return privateJson({ error: "Invalid credentials" }, { status: 401 });
  const retryAfter = loginRetryAfterSeconds(username);
  if (retryAfter) return privateJson({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(retryAfter) } });
  const user = username && password ? authenticate(username, password) : null;
  if (!user) {
    recordLoginFailure(username);
    return privateJson({ error: "Invalid credentials" }, { status: 401 });
  }
  clearLoginFailures(username);
  const session = createSession(user.id, null, request); const response = privateJson({ user });
  response.cookies.set("vessel-token", session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: sessionLifetimeSeconds(), path: "/" }); return response;
}
export async function patchAuth(request: Request) {
  const user = currentUser(token(request));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { email?: string } | null;
  try {
    const email = updateUserEmail(user.id, body?.email ?? "");
    const hash = email ? createHash("sha256").update(email.trim().toLowerCase()).digest("hex") : null;
    return privateJson({ user: { ...user, email, avatarUrl: hash ? `https://gravatar.com/avatar/${hash}?s=128&d=identicon` : null } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update profile" }, { status: 400 });
  }
}
export async function deleteAuth(request: Request) { const value = token(request); if (value) revokeSession(value); const response = privateJson({ ok: true }); response.cookies.set("vessel-token", "", { httpOnly: true, expires: new Date(0), path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" }); return response; }
