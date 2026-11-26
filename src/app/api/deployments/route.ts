import { deleteDeployments, getDeployments, postDeployments } from "@/server/api/deployments";
import { NextResponse } from "next/server";
import { withAudit } from "@/lib/audit-log";

export const GET = getDeployments;
export async function POST(request: Request) {
  const engineId = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
  const body = await request.clone().json().catch(() => null) as { action?: unknown } | null;
  // Repository discovery, inspection, previews, and configuration are control-plane
  // operations; they do not execute against the selected Docker Engine. Only actions
  // that inspect or mutate the local Compose checkout require the local Engine.
  const requiresLocalEngine = body?.action === "sync" || body?.action === "list_compose_services";
  if (requiresLocalEngine && engineId && engineId !== "local") {
    return NextResponse.json({ error: "Los despliegues Git todavía se ejecutan únicamente en el Engine local. Cambia a Local antes de iniciar uno." }, { status: 409 });
  }
  return withAudit(request, postDeployments, "deployments");
}
export const DELETE = (request: Request) => withAudit(request, deleteDeployments, "deployments");
