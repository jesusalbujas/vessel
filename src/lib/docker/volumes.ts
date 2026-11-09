import { dockerApiBase, dockerGet, dockerHeaders } from "./client";
import type { DockerVolume } from "./types";

export async function listDockerVolumes(): Promise<DockerVolume[]> {
  const response = await dockerGet<{ Volumes?: DockerVolume[] }>("volumes");
  return response.Volumes ?? [];
}

export async function deleteDockerVolume(name: string): Promise<void> {
  const response = await fetch(`${dockerApiBase()}/volumes/${encodeURIComponent(name)}`, {
    method: "DELETE", headers: dockerHeaders(), cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Docker respondió ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
}

export async function createDockerVolume(name: string): Promise<DockerVolume> {
  const response = await fetch(`${dockerApiBase()}/volumes/create`, {
    method: "POST", headers: dockerHeaders(true), body: JSON.stringify({ Name: name, Driver: "local" }), cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Docker respondió ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  return response.json() as Promise<DockerVolume>;
}
