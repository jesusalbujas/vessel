import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/control-plane";
import { getDockerComposeVersion } from "@/lib/docker/engine";

export async function GET(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.json({ version: await getDockerComposeVersion() }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
}
