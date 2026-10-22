import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { authenticate, createInitialAdmin, createSession, currentUser, passwordPolicy, revokeSession, sessionLifetimeSeconds, updateUserEmail, userCount } from "@/lib/control-plane";

function token(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (bearer) return bearer;
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-token="));
  return cookie ? decodeURIComponent(cookie.slice("vessel-token=".length)) : null;
}
export async function getAuth(request: Request) { return NextResponse.json({ user: currentUser(token(request)), setupRequired: userCount() === 0, passwordPolicy: passwordPolicy() }); }
export async function postAuth(request: Request) {
  const body = await request.json().catch(() => null) as { action?: "login" | "setup"; username?: string; password?: string } | null;
  if (body?.action === "setup") {
    try {
      const user = createInitialAdmin(body.username ?? "", body.password ?? "");
      const session = createSession(user.id); const response = NextResponse.json({ user, token: session, setupCompleted: true }, { status: 201 });
      response.cookies.set("vessel-token", session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: sessionLifetimeSeconds(), path: "/" }); return response;
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create administrator" }, { status: 400 });
    }
  }
  const user = body?.username && body.password ? authenticate(body.username, body.password) : null;
  if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  const session = createSession(user.id); const response = NextResponse.json({ user, token: session });
  response.cookies.set("vessel-token", session, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: sessionLifetimeSeconds(), path: "/" }); return response;
}
export async function patchAuth(request: Request) {
  const user = currentUser(token(request));
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const body = await request.json().catch(() => null) as { email?: string } | null;
  try {
    const email = updateUserEmail(user.id, body?.email ?? "");
    const hash = email ? createHash("sha256").update(email.trim().toLowerCase()).digest("hex") : null;
    return NextResponse.json({ user: { ...user, email, avatarUrl: hash ? `https://gravatar.com/avatar/${hash}?s=128&d=identicon` : null } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update profile" }, { status: 400 });
  }
}
export async function deleteAuth(request: Request) { const value = token(request); if (value) revokeSession(value); const response = NextResponse.json({ ok: true }); response.cookies.set("vessel-token", "", { httpOnly: true, expires: new Date(0), path: "/" }); return response; }
