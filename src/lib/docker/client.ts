import { currentDockerEngineId, currentDockerRequestSignal } from "@/lib/docker/engine-context";

function vesselBackendUrl(): string | null {
  const value = process.env.VESSEL_BACKEND_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

export function dockerApiBase(): string {
  const backend = vesselBackendUrl();
  if (!backend) throw new Error("El backend de Docker Engine de Vessel no está configurado");
  return backend;
}

export function isDockerConfigured(): boolean {
  return Boolean(vesselBackendUrl());
}

export function dockerHeaders(json = false): Record<string, string> {
  const engineId = currentDockerEngineId();
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(engineId ? { "X-Vessel-Engine-ID": engineId } : {}),
  };
}

export async function dockerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${dockerApiBase()}/${path}`, {
    headers: dockerHeaders(),
    cache: "no-store",
    signal: currentDockerRequestSignal() ?? AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).replace(/\s+/g, " ").trim().slice(0, 240);
    throw new Error(detail ? `Docker respondió ${response.status}: ${detail}` : `Docker respondió ${response.status}`);
  }
  return response.json() as Promise<T>;
}
