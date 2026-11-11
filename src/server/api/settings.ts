import { NextResponse } from "next/server";
import { authenticatedUser, getPlatformSettings, updatePlatformSettings, userHasPermission, type PlatformSettingsUpdate } from "@/lib/control-plane";

export async function getSettings(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ data: getPlatformSettings(), canManage: userHasPermission(user, "settings.manage") });
}

export async function patchSettings(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!userHasPermission(user, "settings.manage")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const body = await request.json().catch(() => null) as PlatformSettingsUpdate | null;
  if (!body || typeof body !== "object" || !Object.keys(body).length) return NextResponse.json({ error: "At least one setting is required" }, { status: 400 });
  try { return NextResponse.json({ data: updatePlatformSettings(body) }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to update settings" }, { status: 400 }); }
}
