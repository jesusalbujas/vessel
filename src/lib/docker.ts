import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { registryCredentialsForImage } from "./control-plane";
import { ecrDockerCredentials } from "./ecr";
import { registryServerAddress, type RegistryProvider } from "./registries";
import type { ContainerRuntimeSettings, RestartPolicy } from "./services";

export type RestartPolicyConfig = { name: RestartPolicy; maxRetries?: number };

export type DockerContainer = {
  Id: string;
  Names?: string[];
  State?: string;
  Status?: string;
  Labels?: Record<string, string>;
  Image?: string;
  ImageID?: string;
  Ports?: Array<{ IP?: string; PublicPort?: number; PrivatePort?: number; Type?: string }>;
  Created?: number;
  Mounts?: Array<{ Type?: string; Name?: string }>;
};

export type DockerContainerDetails = {
  Name?: string;
  Config?: Record<string, unknown> & { Env?: string[]; Image?: string; Cmd?: string[] | null; Entrypoint?: string[] | null; WorkingDir?: string; User?: string; Tty?: boolean; OpenStdin?: boolean };
  HostConfig?: Record<string, unknown> & { PortBindings?: Record<string, Array<{ HostIp?: string; HostPort?: string }>>; RestartPolicy?: { Name?: string; MaximumRetryCount?: number }; LogConfig?: { Type?: string; Config?: Record<string, string> }; Memory?: number; NanoCpus?: number; CpuQuota?: number; CpuPeriod?: number };
  NetworkSettings?: { Networks?: Record<string, { IPAddress?: string; GlobalIPv6Address?: string; [key: string]: unknown }> };
  State?: { Running?: boolean };
  Mounts?: Array<{ Type?: string; Name?: string }>;
};

export type DockerImage = {
  Id: string;
  RepoTags?: string[] | null;
  RepoDigests?: string[] | null;
  Created?: number;
  Size?: number;
};

export type DockerVolume = {
  Name: string;
  Driver?: string;
  Mountpoint?: string;
  CreatedAt?: string;
  Labels?: Record<string, string>;
};

export type DockerNetwork = {
  Id: string;
  Name: string;
  Driver?: string;
  Scope?: string;
  Attachable?: boolean;
  Created?: string;
  Labels?: Record<string, string>;
  EnableIPv6?: boolean;
  IPAM?: { Driver?: string; Config?: Array<{ Subnet?: string; Gateway?: string; IPRange?: string }> };
  Containers?: Record<string, { Name?: string; IPv4Address?: string; IPv6Address?: string; MacAddress?: string }>;
};

export type DockerAction = "start" | "stop" | "restart" | "kill" | "pause" | "unpause";
export type DockerEngineInfo = {
  Name?: string;
  ServerVersion?: string;
  ComposeVersion?: string | null;
  OperatingSystem?: string;
  OSType?: string;
  Architecture?: string;
  NCPU?: number;
  MemTotal?: number;
  DockerRootDir?: string;
  Driver?: string;
  Containers?: number;
  ContainersRunning?: number;
  ContainersPaused?: number;
  ContainersStopped?: number;
  Images?: number;
  Swarm?: { LocalNodeState?: string; ControlAvailable?: boolean; Nodes?: number; NodeID?: string };
};

function vesselBackendUrl(): string | null {
  const value = process.env.VESSEL_BACKEND_URL?.trim();
  return value ? value.replace(/\/$/, "") : null;
}

function dockerApiBase(): string {
  const backend = vesselBackendUrl();
  if (!backend) throw new Error("El backend de Docker Engine de Vessel no está configurado");
  return backend;
}

function dockerHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export function isDockerConfigured(): boolean {
  return Boolean(vesselBackendUrl());
}

export async function listDockerContainers(): Promise<DockerContainer[]> {
  if (!isDockerConfigured()) return [];
  const response = await fetch(`${dockerApiBase()}/containers/json?all=true`, {
    headers: dockerHeaders(),
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`Docker respondió ${response.status}`);
  return response.json() as Promise<DockerContainer[]>;
}

async function dockerGet<T>(path: string): Promise<T> {
  const response = await fetch(`${dockerApiBase()}/${path}`, {
    headers: dockerHeaders(),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Docker respondió ${response.status}`);
  return response.json() as Promise<T>;
}

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

export function inspectDockerContainer(containerId: string): Promise<DockerContainerDetails> {
  return dockerGet<DockerContainerDetails>(`containers/${encodeURIComponent(containerId)}/json`);
}

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

export function listDockerNetworks(): Promise<DockerNetwork[]> {
  return dockerGet<DockerNetwork[]>("networks");
}

export function getDockerEngineInfo(): Promise<DockerEngineInfo> {
  return dockerGet<DockerEngineInfo>("info");
}

export async function getDockerComposeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["compose", "version", "--short"], { stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    const timeout = setTimeout(() => { child.kill("SIGKILL"); resolve(null); }, 3000);
    child.stdout.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString()}`.slice(0, 256); });
    child.once("error", () => { clearTimeout(timeout); resolve(null); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) return resolve(null);
      const version = output.trim().match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/i)?.[0];
      resolve(version ?? null);
    });
  });
}

export async function testDockerRegistryCredentials(credentials: { provider: RegistryProvider; url: string; baseUrl?: string | null; region?: string | null; username: string; password: string }): Promise<void> {
  if (!isDockerConfigured()) throw new Error("El backend Docker no está configurado; no se pueden probar las credenciales");
  const dockerCredentials = credentials.provider === "ecr" ? await ecrDockerCredentials(credentials) : credentials;
  let response: Response;
  try {
    response = await fetch(`${dockerApiBase()}/auth`, {
      method: "POST",
      headers: dockerHeaders(true),
      body: JSON.stringify({ username: dockerCredentials.username, password: dockerCredentials.password, serveraddress: registryServerAddress(credentials.provider, credentials.url, credentials.baseUrl) }),
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error("El Engine tardó demasiado en validar el registry");
    throw new Error("No fue posible conectar con Docker Engine para validar el registry");
  }
  if (response.ok) return;
  if (response.status === 401 || response.status === 403) throw new Error("Docker Engine rechazó las credenciales; verifica usuario, token y permisos de lectura");
  throw new Error(`Docker Engine no pudo validar el registry (HTTP ${response.status})`);
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
  let multiplexed = bytes.length >= 8 && (bytes[0] === 0 || bytes[0] === 1 || bytes[0] === 2) && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 0;
  while (multiplexed && offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset + 4, 4).getUint32(0);
    if (length > bytes.length - offset - 8) {
      multiplexed = false;
      break;
    }
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
  if (newImage && newImage !== inspect.Config?.Image) {
    const registryHeaders = await registryAuthHeaders(newImage, headers);
    const pullResponse = await fetch(`${prefix}/images/create?fromImage=${encodeURIComponent(newImage)}`, { method: "POST", headers: registryHeaders, cache: "no-store" });
    if (!pullResponse.ok) throw new Error(`No se pudo descargar la imagen (${pullResponse.status})`);
    await consumeImagePull(pullResponse, onImageProgress);
  }
  const wasRunning = Boolean(inspect.State?.Running);
  const hostConfig = { ...(inspect.HostConfig ?? {}) };
  const portBindings = { ...(hostConfig.PortBindings ?? {}) };
  let changed = false;
  if (oldPort !== null && newPort !== null) {
    for (const [containerPort, bindings] of Object.entries(portBindings)) {
      const nextBindings = bindings.map((binding) => {
        if (Number(binding.HostPort) !== oldPort) return binding;
        changed = true;
        return { ...binding, HostPort: String(newPort) };
      });
      portBindings[containerPort] = nextBindings;
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

async function registryAuthHeaders(image: string, baseHeaders: Record<string, string>): Promise<Record<string, string>> {
  const savedCredentials = registryCredentialsForImage(image);
  if (savedCredentials) {
    const dockerCredentials = savedCredentials.provider === "ecr" ? await ecrDockerCredentials(savedCredentials) : savedCredentials;
    const registryAuth = { username: dockerCredentials.username, password: dockerCredentials.password, serveraddress: registryServerAddress(savedCredentials.provider, savedCredentials.url, savedCredentials.baseUrl) };
    return { ...baseHeaders, "X-Registry-Auth": Buffer.from(JSON.stringify(registryAuth)).toString("base64") };
  }
  const configPath = process.env.DOCKER_CONFIG_JSON_PATH;
  if (!configPath) return baseHeaders;
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as { auths?: Record<string, Record<string, unknown>> };
    const firstPart = image.split("/")[0];
    const registry = firstPart.includes(".") || firstPart.includes(":") || firstPart === "localhost" ? firstPart : "https://index.docker.io/v1/";
    const auth = config.auths?.[registry] ?? config.auths?.[`https://${registry}`] ?? config.auths?.[`https://${registry}/v1/`];
    if (!auth) return baseHeaders;
    const authConfig: Record<string, unknown> = { ...auth, serveraddress: registry };
    if (typeof authConfig.auth === "string") {
      const decoded = Buffer.from(authConfig.auth, "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        authConfig.username = decoded.slice(0, separator);
        authConfig.password = decoded.slice(separator + 1);
        delete authConfig.auth;
      }
    }
    return { ...baseHeaders, "X-Registry-Auth": Buffer.from(JSON.stringify(authConfig)).toString("base64") };
  } catch {
    return baseHeaders;
  }
}

export async function pullDockerImage(image: string, onProgress?: (percent: number, message: string) => void): Promise<void> {
  const headers = dockerHeaders(true);
  const prefix = dockerApiBase();
  const registryHeaders = await registryAuthHeaders(image, headers);
  const response = await fetch(`${prefix}/images/create?fromImage=${encodeURIComponent(image)}`, { method: "POST", headers: registryHeaders, cache: "no-store" });
  if (!response.ok) throw new Error(`No se pudo descargar la imagen (${response.status})`);
  await consumeImagePull(response, onProgress);
}

export async function cloneDockerContainer(containerId: string, newName: string, newPort: number, newImage?: string, onImageProgress?: (percent: number, message: string) => void, environmentVariables?: string[], restartPolicy?: RestartPolicyConfig, runtimeSettings?: ContainerRuntimeSettings): Promise<{ env: string[]; started: boolean; containerId: string | null }> {
  const headers = dockerHeaders(true);
  const prefix = dockerApiBase();
  const inspectResponse = await fetch(`${prefix}/containers/${encodeURIComponent(containerId)}/json`, { headers, cache: "no-store" });
  if (!inspectResponse.ok) throw new Error(`No se pudo inspeccionar el contenedor (${inspectResponse.status})`);
  const inspect = await inspectResponse.json() as DockerContainerDetails;
  if (newImage && newImage !== inspect.Config?.Image) {
    const registryHeaders = await registryAuthHeaders(newImage, headers);
    const pullResponse = await fetch(`${prefix}/images/create?fromImage=${encodeURIComponent(newImage)}`, { method: "POST", headers: registryHeaders, cache: "no-store" });
    if (!pullResponse.ok) throw new Error(`No se pudo descargar la imagen (${pullResponse.status})`);
    await consumeImagePull(pullResponse, onImageProgress);
  }
  const sourcePort = Object.values(inspect.HostConfig?.PortBindings ?? {}).flat().find((binding) => binding.HostPort)?.HostPort;
  if (!sourcePort && newPort) throw new Error("El contenedor origen no tiene un puerto publicado editable");
  const hostConfig = { ...(inspect.HostConfig ?? {}) };
  const portBindings = { ...(hostConfig.PortBindings ?? {}) };
  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    portBindings[containerPort] = bindings.map((binding) => sourcePort && binding.HostPort === sourcePort ? { ...binding, HostPort: String(newPort) } : binding);
  }
  hostConfig.PortBindings = portBindings;
  if (restartPolicy) hostConfig.RestartPolicy = { Name: restartPolicy.name, MaximumRetryCount: restartPolicy.name === "on-failure" ? Math.max(0, restartPolicy.maxRetries ?? 0) : 0 };
  const hasExplicitEnvironment = environmentVariables !== undefined;
  const sourceEnv = hasExplicitEnvironment ? [...environmentVariables] : [...(inspect.Config?.Env ?? [])];
  const env = sourceEnv;
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
  const registryHeaders = await registryAuthHeaders(image, headers);
  const pullResponse = await fetch(`${prefix}/images/create?fromImage=${encodeURIComponent(image)}`, { method: "POST", headers: registryHeaders, cache: "no-store" });
  if (!pullResponse.ok) throw new Error(`No se pudo descargar la imagen (${pullResponse.status})`);
  await consumeImagePull(pullResponse, onImageProgress);
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
