import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isDockerConfigured } from "@/lib/docker/client";
import { listDockerContainers } from "@/lib/docker/containers";
import { authenticatedUser, userHasPermission } from "@/lib/control-plane";
import { currentDockerEngineId } from "@/lib/docker/engine-context";

function isSameOriginBrowserRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",", 1)[0].trim().toLowerCase();
  const fetchSite = request.headers.get("sec-fetch-site");
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (!origin || !host || contentType !== "application/json" || (fetchSite && fetchSite !== "same-origin")) return false;
  try {
    const parsed = new URL(origin);
    const requestScheme = forwardedProto === "http" || forwardedProto === "https"
      ? `${forwardedProto}:`
      : new URL(request.url).protocol;
    return (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash &&
      parsed.host.toLowerCase() === host.toLowerCase() && parsed.protocol === requestScheme;
  } catch {
    return false;
  }
}

export async function postContainerExec(request: Request) {
  if (!isSameOriginBrowserRequest(request)) return NextResponse.json({ error: "Solicitud de consola rechazada: origen no válido" }, { status: 403, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!userHasPermission(user, "containers.exec")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  if (!isDockerConfigured()) return NextResponse.json({ error: "Docker Engine no está configurado" }, { status: 503 });
  try {
    const body = await request.json() as { serviceId?: unknown; shell?: unknown };
    if (typeof body.serviceId !== "string" || !body.serviceId.startsWith("container-")) return NextResponse.json({ error: "Contenedor inválido" }, { status: 400 });
    if (body.shell !== "bash" && body.shell !== "sh") return NextResponse.json({ error: "Shell inválido. Elige bash o sh." }, { status: 400 });
    const container = (await listDockerContainers()).find((item) => body.serviceId === `container-${item.Id.slice(0, 12)}`);
    if (!container) return NextResponse.json({ error: "Contenedor no encontrado" }, { status: 404 });
    if (container.State !== "running") return NextResponse.json({ error: "El contenedor debe estar en ejecución" }, { status: 409 });
    const secret = process.env.VESSEL_SECRET_KEY;
    if (!secret || secret.length < 32) return NextResponse.json({ error: "La consola requiere configurar VESSEL_SECRET_KEY" }, { status: 503 });
    const claims = { sub: user.id, container: container.Id, engine: currentDockerEngineId() || "local", shell: body.shell, exp: Math.floor(Date.now() / 1000) + 60, nonce: randomUUID() };
    const encoded = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
    return NextResponse.json({ token: `${encoded}.${signature}`, name: container.Names?.[0]?.replace(/^\//, "") ?? container.Id.slice(0, 12) }, { headers: { "Cache-Control": "private, no-store", Pragma: "no-cache", "X-Content-Type-Options": "nosniff", Vary: "Cookie, Authorization, Origin" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo preparar la consola" }, { status: 502 });
  }
}
