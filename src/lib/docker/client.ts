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
  return json ? { "Content-Type": "application/json" } : {};
}

export async function dockerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${dockerApiBase()}/${path}`, {
    headers: dockerHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Docker respondió ${response.status}`);
  return response.json() as Promise<T>;
}
