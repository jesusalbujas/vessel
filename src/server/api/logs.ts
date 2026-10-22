import { NextResponse } from "next/server";
import { getPortainerContainerLogs, isPortainerConfigured, listPortainerContainers } from "@/lib/portainer";
import { authenticatedUser } from "@/lib/control-plane";

export async function getLogs(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isPortainerConfigured()) return NextResponse.json({ error: "El backend Docker no está configurado" }, { status: 503 });
  const serviceId = new URL(request.url).searchParams.get("serviceId");
  if (!serviceId?.startsWith("container-")) return NextResponse.json({ error: "Contenedor inválido" }, { status: 400 });
  try {
    const containers = await listPortainerContainers();
    const container = containers.find((item) => serviceId === `container-${item.Id.slice(0, 12)}`);
    if (!container) return NextResponse.json({ error: "Contenedor no encontrado" }, { status: 404 });
    return NextResponse.json({ data: await getPortainerContainerLogs(container.Id), name: container.Names?.[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible leer los logs" }, { status: 502 });
  }
}
