import { NextResponse } from "next/server";
import { authenticatedUser, currentUser, deleteCustomRole, listRoles, permissionCatalog, requestTokenFromRequest, saveCustomRole } from "@/lib/control-plane";

function admin(request: Request) {
  const user = currentUser(requestTokenFromRequest(request));
  return user?.role === "administrator" ? user : null;
}

export function getRoles(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (user.role !== "administrator") return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  return NextResponse.json({ data: listRoles(), permissions: permissionCatalog });
}

export async function postRoles(request: Request) {
  if (!admin(request)) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: unknown; description?: unknown; permissions?: unknown } | null;
  if (!body || typeof body.name !== "string" || (body.description !== undefined && typeof body.description !== "string") || !Array.isArray(body.permissions) || body.permissions.some((item) => typeof item !== "string")) return NextResponse.json({ error: "Invalid role definition." }, { status: 400 });
  try { return NextResponse.json({ data: saveCustomRole({ name: body.name, description: body.description as string | undefined, permissions: body.permissions as string[] }) }, { status: 201 }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save role." }, { status: 400 }); }
}

export async function patchRoles(request: Request) {
  if (!admin(request)) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown; name?: unknown; description?: unknown; permissions?: unknown } | null;
  if (!body || typeof body.id !== "string" || typeof body.name !== "string" || (body.description !== undefined && typeof body.description !== "string") || !Array.isArray(body.permissions) || body.permissions.some((item) => typeof item !== "string")) return NextResponse.json({ error: "Invalid role definition." }, { status: 400 });
  try { return NextResponse.json({ data: saveCustomRole({ id: body.id, name: body.name, description: body.description as string | undefined, permissions: body.permissions as string[] }) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to save role." }, { status: 400 }); }
}

export async function deleteRoles(request: Request) {
  if (!admin(request)) return NextResponse.json({ error: "Administrator access required" }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (typeof body?.id !== "string") return NextResponse.json({ error: "Role id is required." }, { status: 400 });
  try { deleteCustomRole(body.id); return NextResponse.json({ ok: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to delete role." }, { status: 400 }); }
}
