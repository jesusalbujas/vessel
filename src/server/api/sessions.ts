import { NextResponse } from "next/server";
import { authenticatedUser, listSessions, requestTokenFromRequest, revokeManagedSession } from "@/lib/control-plane";

function privateJson(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie, Authorization");
  return NextResponse.json(data, { ...init, headers });
}

function administrator(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return { response: privateJson({ error: "Authentication required" }, { status: 401 }) };
  if (user.role !== "administrator") return { response: privateJson({ error: "Administrator access required" }, { status: 403 }) };
  return { user };
}

export function getSessions(request: Request) {
  const auth = administrator(request);
  if ("response" in auth) return auth.response;
  return privateJson({ data: listSessions(requestTokenFromRequest(request)) });
}

export async function deleteSession(request: Request) {
  const auth = administrator(request);
  if ("response" in auth) return auth.response;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return privateJson({ error: "Session id is invalid" }, { status: 400 });
  const revoked = revokeManagedSession(id, requestTokenFromRequest(request));
  if (!revoked) return privateJson({ error: "Session not found" }, { status: 404 });
  const response = privateJson({ ok: true, current: revoked.isCurrent });
  if (revoked.isCurrent) response.cookies.set("vessel-token", "", { httpOnly: true, expires: new Date(0), path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return response;
}
