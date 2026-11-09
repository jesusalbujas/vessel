import { dockerApiBase, dockerGet, dockerHeaders, isDockerConfigured } from "./client";
import { connectDockerContainer } from "./networks";
import { pullDockerImage } from "./images";
import type { ContainerRuntimeSettings, DockerAction, DockerContainer, DockerContainerDetails, RestartPolicyConfig } from "./types";

export async function listDockerContainers(): Promise<DockerContainer[]> {
  if (!isDockerConfigured()) return [];
  return dockerGet<DockerContainer[]>("containers/json?all=true");
}

export function inspectDockerContainer(containerId: string): Promise<DockerContainerDetails> {
  return dockerGet<DockerContainerDetails>(`containers/${encodeURIComponent(containerId)}/json`);
}

export async function getDockerContainerLogs(containerId: string): Promise<string> {
  const response = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(containerId)}/logs?stdout=true&stderr=true&timestamps=true&tail=300`, {
    headers: dockerHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Docker respondió ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const decoder = new TextDecoder();
  let output = "";
  let offset = 0;
  const multiplexed = bytes.length >= 8 && (bytes[0] === 0 || bytes[0] === 1 || bytes[0] === 2) && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0;
  while (multiplexed && offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
    if (length > bytes.length - offset - 8) break;
    output += decoder.decode(bytes.subarray(offset + 8, offset + 8 + length), { stream: true });
    offset += 8 + length;
  }
  if (multiplexed && offset === bytes.length) return output + decoder.decode();
  return decoder.decode(bytes).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export async function controlDockerContainer(containerId: string, action: DockerAction): Promise<void> {
  const response = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(containerId)}/${action}`, {
    method: "POST",
    headers: dockerHeaders(),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Docker respondió ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
  }
}

export async function deleteDockerContainer(containerId: string): Promise<void> {
  const response = await fetch(`${dockerApiBase()}/containers/${encodeURIComponent(containerId)}?force=true`, {
    method: "DELETE",
    headers: dockerHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`No se pudo borrar el contenedor (${response.status})`);
}

function applyRuntimeSettings(config: Record<string, unknown>, hostConfig: Record<string, unknown>, settings?: ContainerRuntimeSettings): void {
  if (!settings) return;
  config.Cmd = settings.command.length ? settings.command : null;
  config.Entrypoint = settings.entrypoint.length ? settings.entrypoint : null;
  config.WorkingDir = settings.workingDir;
  config.User = settings.user;
  config.Tty = settings.tty;
  config.OpenStdin = settings.openStdin;
  if (settings.logDriver || Object.keys(settings.logOptions).length) hostConfig.LogConfig = { Type: settings.logDriver, Config: settings.logOptions };
  else delete hostConfig.LogConfig;
  hostConfig.Memory = settings.memoryLimitMiB === null ? 0 : Math.round(settings.memoryLimitMiB * 1024 * 1024);
  hostConfig.NanoCpus = settings.cpuLimit === null ? 0 : Math.round(settings.cpuLimit * 1_000_000_000);
  hostConfig.CpuQuota = 0;
  hostConfig.CpuPeriod = 0;
}

export async function recreateDockerContainer(containerId: string, newName: string, oldPort: number | null, newPort: number | null, newImage?: string, onImageProgress?: (percent: number, message: string) => void, environmentVariables?: string[], restartPolicy?: RestartPolicyConfig, runtimeSettings?: ContainerRuntimeSettings): Promise<string | null> {
  const headers = dockerHeaders(true);
  const prefix = dockerApiBase();
  const inspectResponse = await fetch(`${prefix}/containers/${encodeURIComponent(containerId)}/json`, { headers, cache: "no-store" });
  if (!inspectResponse.ok) throw new Error(`No se pudo inspeccionar el contenedor (${inspectResponse.status})`);
  const inspect = await inspectResponse.json() as DockerContainerDetails;
  if (newImage && newImage !== inspect.Config?.Image) await pullDockerImage(newImage, onImageProgress);

  const wasRunning = Boolean(inspect.State?.Running);
  const hostConfig = { ...(inspect.HostConfig ?? {}) };
  const portBindings = { ...(hostConfig.PortBindings ?? {}) };
  let changed = false;
  if (oldPort !== null && newPort !== null) {
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      portBindings[containerPort] = bindings.map((binding) => {
        if (Number(binding.HostPort) !== oldPort) return binding;
        changed = true;
        return { ...binding, HostPort: String(newPort) };
      });
    }
  }
  if (oldPort === null && newPort !== null) {
    const exposedPorts = (inspect.Config?.ExposedPorts ?? {}) as Record<string, unknown>;
    const internalPort = Object.keys(portBindings)[0] ?? Object.keys(exposedPorts)[0] ?? `${newPort}/tcp`;
    portBindings[internalPort] = [{ HostPort: String(newPort) }];
    if (!exposedPorts[internalPort]) exposedPorts[internalPort] = {};
    (inspect.Config as Record<string, unknown>).ExposedPorts = exposedPorts;
    changed = true;
  }
  if (!changed) throw new Error("No se encontró el puerto publicado original");
  hostConfig.PortBindings = portBindings;
  if (restartPolicy) hostConfig.RestartPolicy = { Name: restartPolicy.name, MaximumRetryCount: restartPolicy.name === "on-failure" ? Math.max(0, restartPolicy.maxRetries ?? 0) : 0 };

  if (wasRunning) {
    const stopResponse = await fetch(`${prefix}/containers/${encodeURIComponent(containerId)}/stop`, { method: "POST", headers, cache: "no-store" });
    if (!stopResponse.ok && stopResponse.status !== 304) throw new Error(`No se pudo detener el contenedor (${stopResponse.status})`);
  }
  const removeResponse = await fetch(`${prefix}/containers/${encodeURIComponent(containerId)}?force=true`, { method: "DELETE", headers, cache: "no-store" });
  if (!removeResponse.ok) throw new Error(`No se pudo recrear el contenedor (${removeResponse.status})`);

  const config = { ...(inspect.Config ?? {}), ...(newImage ? { Image: newImage } : {}), ...(environmentVariables ? { Env: environmentVariables } : {}) } as Record<string, unknown>;
  applyRuntimeSettings(config, hostConfig, runtimeSettings);
  const createResponse = await fetch(`${prefix}/containers/create?name=${encodeURIComponent(newName)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...config, HostConfig: hostConfig, NetworkingConfig: { EndpointsConfig: inspect.NetworkSettings?.Networks ?? {} } }),
    cache: "no-store",
  });
  if (!createResponse.ok) throw new Error(`No se pudo crear el contenedor nuevo (${createResponse.status})`);
  const created = await createResponse.json() as { Id?: string };
  if (wasRunning && created.Id) {
    const startResponse = await fetch(`${prefix}/containers/${encodeURIComponent(created.Id)}/start`, { method: "POST", headers, cache: "no-store" });
    if (!startResponse.ok && startResponse.status !== 304) throw new Error(`El contenedor fue creado pero no pudo iniciar (${startResponse.status})`);
  }
  return created.Id ?? null;
}

export async function cloneDockerContainer(containerId: string, newName: string, newPort: number, newImage?: string, onImageProgress?: (percent: number, message: string) => void, environmentVariables?: string[], restartPolicy?: RestartPolicyConfig, runtimeSettings?: ContainerRuntimeSettings): Promise<{ env: string[]; started: boolean; containerId: string | null }> {
  const headers = dockerHeaders(true);
  const prefix = dockerApiBase();
  const inspectResponse = await fetch(`${prefix}/containers/${encodeURIComponent(containerId)}/json`, { headers, cache: "no-store" });
  if (!inspectResponse.ok) throw new Error(`No se pudo inspeccionar el contenedor (${inspectResponse.status})`);
  const inspect = await inspectResponse.json() as DockerContainerDetails;
  if (newImage && newImage !== inspect.Config?.Image) await pullDockerImage(newImage, onImageProgress);
  const sourcePort = Object.values(inspect.HostConfig?.PortBindings ?? {}).flat().find((binding) => binding.HostPort)?.HostPort;
  if (!sourcePort && newPort) throw new Error("El contenedor origen no tiene un puerto publicado editable");
  const hostConfig = { ...(inspect.HostConfig ?? {}) };
  const portBindings = { ...(hostConfig.PortBindings ?? {}) };
  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    portBindings[containerPort] = bindings.map((binding) => sourcePort && binding.HostPort === sourcePort ? { ...binding, HostPort: String(newPort) } : binding);
  }
  hostConfig.PortBindings = portBindings;
  if (restartPolicy) hostConfig.RestartPolicy = { Name: restartPolicy.name, MaximumRetryCount: restartPolicy.name === "on-failure" ? Math.max(0, restartPolicy.maxRetries ?? 0) : 0 };
  const env = environmentVariables !== undefined ? [...environmentVariables] : [...(inspect.Config?.Env ?? [])];
  const labels = Object.fromEntries(Object.entries((inspect.Config?.Labels ?? {}) as Record<string, string>).filter(([key]) => !key.startsWith("com.docker.compose.")));
  const config = { ...(inspect.Config ?? {}), Labels: labels, Env: env, ...(newImage ? { Image: newImage } : {}) } as Record<string, unknown>;
  applyRuntimeSettings(config, hostConfig, runtimeSettings);
  const createResponse = await fetch(`${prefix}/containers/create?name=${encodeURIComponent(newName)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...config, HostConfig: hostConfig, NetworkingConfig: { EndpointsConfig: inspect.NetworkSettings?.Networks ?? {} } }),
    cache: "no-store",
  });
  if (!createResponse.ok) {
    const detail = await createResponse.text().catch(() => "");
    throw new Error(`No se pudo crear el contenedor duplicado (${createResponse.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  const created = await createResponse.json() as { Id?: string };
  const started = Boolean(inspect.State?.Running);
  if (started && created.Id) {
    const startResponse = await fetch(`${prefix}/containers/${encodeURIComponent(created.Id)}/start`, { method: "POST", headers, cache: "no-store" });
    if (!startResponse.ok && startResponse.status !== 304) throw new Error(`El duplicado fue creado pero no pudo iniciar (${startResponse.status})`);
  }
  return { env, started, containerId: created.Id ?? null };
}

export async function createDockerContainer(name: string, image: string, internalPort: number, publicPort: number, onImageProgress?: (percent: number, message: string) => void, environmentVariables?: string[], restartPolicy: RestartPolicyConfig = { name: "no" }, runtimeSettings?: ContainerRuntimeSettings, networkId?: string): Promise<string | null> {
  const headers = dockerHeaders(true);
  const prefix = dockerApiBase();
  await pullDockerImage(image, onImageProgress);
  const containerPort = `${internalPort}/tcp`;
  const hostConfig: Record<string, unknown> = { PortBindings: { [containerPort]: [{ HostPort: String(publicPort) }] }, RestartPolicy: { Name: restartPolicy.name, MaximumRetryCount: restartPolicy.name === "on-failure" ? Math.max(0, restartPolicy.maxRetries ?? 0) : 0 } };
  const config: Record<string, unknown> = { Image: image, ExposedPorts: { [containerPort]: {} }, ...(environmentVariables?.length ? { Env: environmentVariables } : {}) };
  applyRuntimeSettings(config, hostConfig, runtimeSettings);
  const createResponse = await fetch(`${prefix}/containers/create?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...config, HostConfig: hostConfig }),
    cache: "no-store",
  });
  if (!createResponse.ok) {
    const detail = await createResponse.text().catch(() => "");
    throw new Error(`No se pudo crear el servicio (${createResponse.status})${detail ? `: ${detail.slice(0, 180)}` : ""}`);
  }
  const created = await createResponse.json() as { Id?: string };
  if (created.Id) {
    if (networkId) {
      try {
        await connectDockerContainer(networkId, created.Id);
      } catch (error) {
        await deleteDockerContainer(created.Id).catch(() => undefined);
        throw error;
      }
    }
    const startResponse = await fetch(`${prefix}/containers/${encodeURIComponent(created.Id)}/start`, { method: "POST", headers, cache: "no-store" });
    if (!startResponse.ok && startResponse.status !== 304) throw new Error(`El servicio fue creado pero no pudo iniciar (${startResponse.status})`);
  }
  return created.Id ?? null;
}
