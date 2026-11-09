import { NextResponse } from "next/server";
import { createUserApiToken, currentUser, listUserApiTokens, revokeUserApiToken } from "@/lib/control-plane";

function response(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie" } });
}

function sessionUser(request: Request) {
  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-token="));
  const sessionToken = cookie ? decodeURIComponent(cookie.slice("vessel-token=".length)) : null;
  return currentUser(sessionToken);
}

export async function getUserTokens(request: Request) {
  const user = sessionUser(request);
  if (!user) return response({ error: "Authentication required" }, 401);
  return response({ data: listUserApiTokens(user.id) });
}

export async function postUserToken(request: Request) {
  const user = sessionUser(request);
  if (!user) return response({ error: "Authentication required" }, 401);
  const body = await request.json().catch(() => null) as { name?: unknown; expiresInDays?: unknown } | null;
  if (!body || typeof body.name !== "string") return response({ error: "Token name is required" }, 400);
  const expiresInDays = body.expiresInDays === null ? null : Number(body.expiresInDays);
  try {
    return response({ data: createUserApiToken(user.id, body.name, expiresInDays) }, 201);
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "Could not create API token" }, 400);
  }
}

export async function deleteUserToken(request: Request) {
  const user = sessionUser(request);
  if (!user) return response({ error: "Authentication required" }, 401);
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (!body || typeof body.id !== "string") return response({ error: "Token id is required" }, 400);
  return revokeUserApiToken(user.id, body.id)
    ? response({ success: true })
    : response({ error: "API token not found" }, 404);
}
