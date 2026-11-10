import { deleteDeployments, getDeployments, postDeployments } from "@/server/api/deployments";
import { NextResponse } from "next/server";
import { withAudit } from "@/lib/audit-log";

export const GET = getDeployments;
export async function POST(request: Request) {
  const engineId = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
  if (engineId && engineId !== "local") {
    return NextResponse.json({ error: "Los despliegues Git todavía se ejecutan únicamente en el Engine local. Cambia a Local antes de iniciar uno." }, { status: 409 });
  }
  return withAudit(request, postDeployments, "deployments");
}
export const DELETE = (request: Request) => withAudit(request, deleteDeployments, "deployments");
