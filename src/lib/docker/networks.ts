import { dockerApiBase, dockerGet, dockerHeaders } from "./client";
import type { DockerNetwork } from "./types";

export function listDockerNetworks(): Promise<DockerNetwork[]> {
  return dockerGet<DockerNetwork[]>("networks");
}

export async function connectDockerContainer(networkId: string, containerId: string): Promise<void> {
  await changeDockerNetworkConnection(networkId, containerId, "connect");
}

export async function disconnectDockerContainer(networkId: string, containerId: string): Promise<void> {
  await changeDockerNetworkConnection(networkId, containerId, "disconnect");
}

async function changeDockerNetworkConnection(networkId: string, containerId: string, action: "connect" | "disconnect"): Promise<void> {
  const response = await fetch(`${dockerApiBase()}/networks/${encodeURIComponent(networkId)}/${action}`, {
    method: "POST",
    headers: dockerHeaders(true),
    body: JSON.stringify({ Container: containerId }),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`No se pudo ${action === "connect" ? "conectar" : "desconectar"} el contenedor (${response.status})${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
}
