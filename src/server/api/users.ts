import { NextResponse } from "next/server";
import { createUser, currentUser, deleteManagedUser, listUsers, passwordPolicy, requestTokenFromRequest, updateManagedUser } from "@/lib/control-plane";
function auth(request: Request) { return currentUser(requestTokenFromRequest(request)); }
export async function getUsers(request: Request) { const user = auth(request); if (!user || user.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 }); return NextResponse.json({ data: listUsers(), passwordPolicy: passwordPolicy() }); }
export async function postUsers(request: Request) { const user = auth(request); if (!user || user.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 }); try { const body = await request.json() as { username?: string; password?: string; role?: string; email?: string }; return NextResponse.json({ data: createUser(body.username ?? "", body.password ?? "", body.role ?? "operator", body.email) }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create user" }, { status: 400 }); } }
export async function patchUsers(request: Request) {
  const actor = auth(request);
  if (!actor || actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  try {
    const body = await request.json() as { id?: string; username?: string; email?: string; role?: string; enabled?: boolean; password?: string };
    if (!body.id || typeof body.enabled !== "boolean") return NextResponse.json({ error: "User id and enabled status are required." }, { status: 400 });
    const data = updateManagedUser({ userId: body.id, actorId: actor.id, username: body.username ?? "", email: body.email, role: body.role ?? "operator", enabled: body.enabled, password: body.password });
    return NextResponse.json({ data });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update user." }, { status: 400 }); }
}
export async function deleteUser(request: Request) {
  const actor = auth(request);
  if (!actor || actor.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  try {
    const body = await request.json() as { id?: string };
    if (!body.id) return NextResponse.json({ error: "User id is required." }, { status: 400 });
    deleteManagedUser(body.id, actor.id);
    return NextResponse.json({ success: true });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete user." }, { status: 400 }); }
}
