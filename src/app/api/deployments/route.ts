import { deleteDeployments, getDeployments, postDeployments } from "@/server/api/deployments";
import { NextResponse } from "next/server";

export const GET = getDeployments;
export async function POST(request: Request) {
  const engineId = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("vessel-engine-id="))?.slice("vessel-engine-id=".length);
  if (engineId && engineId !== "local") {
    return NextResponse.json({ error: "Los despliegues Git todavía se ejecutan únicamente en el Engine local. Cambia a Local antes de iniciar uno." }, { status: 409 });
  }
  return postDeployments(request);
}
export const DELETE = deleteDeployments;
