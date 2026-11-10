import { NextResponse } from "next/server";
import { authenticatedUser, listVesselProjects } from "@/lib/control-plane";
import { currentDockerRequestSignal } from "@/lib/docker/engine-context";
import { dockerApiBase, dockerHeaders } from "@/lib/docker/client";
import { getDockerComposeVersion } from "@/lib/docker/engine";
import type { DockerContainer, DockerEngineInfo, DockerImage, DockerNetwork, DockerVolume } from "@/lib/docker/types";

type DockerOverviewPayload = {
  containers: DockerContainer[];
  images: DockerImage[];
  volumes: { Volumes?: DockerVolume[] };
  networks: DockerNetwork[];
  engine: DockerEngineInfo;
};

function summarizeContainer(container: DockerContainer) {
  return {
    name: (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, ""),
    status: container.State === "paused" ? "paused" : container.State === "running" && /unhealthy/i.test(container.Status ?? "") ? "unhealthy" : container.State === "running" && /health:\s*starting/i.test(container.Status ?? "") ? "starting" : container.State === "running" ? "running" : "stopped",
    composeProject: container.Labels?.["com.docker.compose.project"] ?? null,
  };
}

function publicEngineInfo(engine: DockerEngineInfo, composeVersion: string | null): DockerEngineInfo {
  return {
    Name: engine.Name,
    ServerVersion: engine.ServerVersion,
    ComposeVersion: composeVersion,
    OperatingSystem: engine.OperatingSystem,
    OSType: engine.OSType,
    Architecture: engine.Architecture,
    NCPU: engine.NCPU,
    MemTotal: engine.MemTotal,
    DockerRootDir: engine.DockerRootDir,
    Driver: engine.Driver,
    Containers: engine.Containers,
    ContainersRunning: engine.ContainersRunning,
    ContainersPaused: engine.ContainersPaused,
    ContainersStopped: engine.ContainersStopped,
    Images: engine.Images,
    Swarm: engine.Swarm ? { LocalNodeState: engine.Swarm.LocalNodeState, Nodes: engine.Swarm.Nodes } : undefined,
  };
}

export async function getOverview(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const composeVersionPromise = getDockerComposeVersion();
    const response = await fetch(`${dockerApiBase()}/overview`, {
        headers: dockerHeaders(),
        cache: "no-store",
        signal: currentDockerRequestSignal() ?? AbortSignal.timeout(30_000),
      });
    if (!response.ok) return NextResponse.json({ error: "No fue posible consultar el resumen de Docker" }, { status: 502 });
    const payload = await response.json() as DockerOverviewPayload;
    const composeVersion = await Promise.race([
      composeVersionPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 250)),
    ]);
    const portalName = process.env.VESSEL_CONTAINER_NAME ?? "vessel";
    const containers = payload.containers.filter((container) => !(container.Names ?? []).some((name) => name.replace(/^\//, "") === portalName));
    const projects = new Map<string, { name: string; containers: string[] }>();
    for (const container of containers) {
      const projectName = container.Labels?.["com.docker.compose.project"];
      if (!projectName) continue;
      const project = projects.get(projectName) ?? { name: projectName, containers: [] };
      project.containers.push((container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, ""));
      projects.set(projectName, project);
    }
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = process.env.PUBLIC_SERVICE_HOST?.trim() || (forwardedHost ? new URL(`${new URL(request.url).protocol}//${forwardedHost}`).hostname : new URL(request.url).hostname);
    return NextResponse.json({
      data: {
        containers: containers.map(summarizeContainer),
        projects: [...projects.values()].sort((a, b) => a.name.localeCompare(b.name)),
        images: payload.images.length,
        volumes: payload.volumes.Volumes?.length ?? 0,
        networks: payload.networks.length,
        workspaces: listVesselProjects(),
        host,
        engine: publicEngineInfo(payload.engine, composeVersion),
      },
    }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 240) : "Error desconocido";
    return NextResponse.json({ error: `No fue posible consultar el resumen de Docker: ${message}` }, { status: 502 });
  }
}
