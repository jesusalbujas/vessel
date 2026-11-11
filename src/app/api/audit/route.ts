import { NextResponse } from "next/server";
import { authenticatedUser, userHasPermission } from "@/lib/control-plane";
import { listAuditEvents } from "@/lib/audit-log";

export const runtime = "nodejs";

export function GET(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  if (!userHasPermission(user, "audit.view")) return NextResponse.json({ error: "Permission denied" }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return NextResponse.json(listAuditEvents(limit, offset), { headers: { "Cache-Control": "private, no-store" } });
}
