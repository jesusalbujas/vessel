import { dockerApiBase, dockerGet, dockerHeaders } from "./client";
import { registryAuthHeaders } from "./registry-auth";
import type { DockerImage } from "./types";

export function listDockerImages(): Promise<DockerImage[]> {
  return dockerGet<DockerImage[]>("images/json");
}

export async function deleteDockerImage(imageId: string): Promise<void> {
  const response = await fetch(`${dockerApiBase()}/images/${encodeURIComponent(imageId)}`, {
    method: "DELETE",
    headers: dockerHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Docker respondió ${response.status}${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
}

export async function pullDockerImage(image: string, onProgress?: (percent: number, message: string) => void): Promise<void> {
  const headers = dockerHeaders(true);
  const registryHeaders = await registryAuthHeaders(image, headers);
  const response = await fetch(`${dockerApiBase()}/images/create?fromImage=${encodeURIComponent(image)}`, { method: "POST", headers: registryHeaders, cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo descargar la imagen (${response.status})`);
  await consumeImagePull(response, onProgress);
}

async function consumeImagePull(response: Response, onProgress?: (percent: number, message: string) => void): Promise<void> {
  if (!response.body) {
    await response.arrayBuffer();
    onProgress?.(100, "Imagen descargada");
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const layers = new Map<string, { current: number; total: number }>();
  let buffer = "";
  const consume = (line: string) => {
    try {
      const event = JSON.parse(line) as { status?: string; id?: string; progressDetail?: { current?: number; total?: number } };
      const detail = event.progressDetail;
      if (event.id && detail?.total) layers.set(event.id, { current: detail.current ?? 0, total: detail.total });
      const totals = [...layers.values()];
      if (totals.length) {
        const percent = Math.max(1, Math.min(99, Math.round(totals.reduce((sum, layer) => sum + layer.current, 0) / totals.reduce((sum, layer) => sum + layer.total, 0) * 100)));
        onProgress?.(percent, event.status ? `${event.status}${event.id ? ` · ${event.id}` : ""}` : "Descargando imagen");
      } else if (event.status) onProgress?.(5, event.status);
    } catch {
      // Docker may send a non-JSON informational line; it does not affect the pull.
    }
  };
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    lines.filter(Boolean).forEach(consume);
  }
  if (buffer.trim()) consume(buffer);
  onProgress?.(100, "Imagen descargada");
}
