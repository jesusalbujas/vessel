import { NextResponse } from "next/server";
import { cloneDockerContainer, connectDockerContainer, controlDockerContainer, createDockerContainer, deleteDockerContainer, disconnectDockerContainer, inspectDockerContainer, isDockerConfigured, listDockerContainers, listDockerNetworks, recreateDockerContainer, type DockerAction, type DockerContainer } from "@/lib/docker";
import { cloneDataResource, detectDataSource, updateDataResourceName, validDataResourceName } from "@/lib/data-copy";
import { startCloneJob, startOperationJob } from "@/lib/jobs";
import type { ContainerRuntimeSettings, RestartPolicy, ServiceCategory } from "@/lib/services";
import { authenticatedUser, mutationUser } from "@/lib/control-plane";

type RestartPolicyInput = { name?: string; maxRetries?: number };
type RuntimeSettingsInput = Partial<ContainerRuntimeSettings>;

function parseRuntimeSettings(input: RuntimeSettingsInput | undefined): ContainerRuntimeSettings | undefined {
  if (input === undefined) return undefined;
  const parseArgs = (value: unknown, label: string): string[] => {
    if (!Array.isArray(value) || value.length > 128 || value.some((item) => typeof item !== "string" || item.length > 4096 || item.includes("\0"))) {
      throw new Error(`La configuración de ${label} no es válida`);
    }
    return value as string[];
  };
  const parseText = (value: unknown, label: string): string => {
    if (typeof value !== "string" || value.length > 4096 || value.includes("\0")) throw new Error(`El valor de ${label} no es válido`);
    return value;
  };
  const parseLimit = (value: unknown, label: string, max: number): number | null => {
    if (value === null) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > max) throw new Error(`El límite de ${label} debe estar entre 0 y ${max}`);
    return number;
  };
  if (typeof input.tty !== "boolean" || typeof input.openStdin !== "boolean") throw new Error("Las opciones de consola no son válidas");
  const logDriver = parseText(input.logDriver, "driver de logs");
  if (logDriver && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(logDriver)) throw new Error("El driver de logs no es válido");
  if (!input.logOptions || typeof input.logOptions !== "object" || Array.isArray(input.logOptions)) throw new Error("Las opciones de logs no son válidas");
  const logOptions: Record<string, string> = {};
  const entries = Object.entries(input.logOptions);
  if (entries.length > 32) throw new Error("Hay demasiadas opciones de logs");
  for (const [key, value] of entries) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key) || typeof value !== "string" || value.length > 1024 || value.includes("\0")) throw new Error("Una opción de logs no es válida");
    logOptions[key] = value;
  }
  if (logOptions["max-size"] && !/^\d+(?:\.\d+)?\s*(?:b|k|m|g)?$/i.test(logOptions["max-size"])) throw new Error("El tamaño máximo de logs debe usar un valor como 100m o 1g");
  if (logOptions["max-file"] && (!/^\d+$/.test(logOptions["max-file"]) || Number(logOptions["max-file"]) < 1 || Number(logOptions["max-file"]) > 1000)) throw new Error("La cantidad de archivos de log debe estar entre 1 y 1000");
  return {
    command: parseArgs(input.command, "Command"),
    entrypoint: parseArgs(input.entrypoint, "Entrypoint"),
    workingDir: parseText(input.workingDir, "Working directory"),
    user: parseText(input.user, "User"),
    tty: input.tty,
    openStdin: input.openStdin,
    logDriver,
    logOptions,
    memoryLimitMiB: parseLimit(input.memoryLimitMiB, "memoria (MiB)", 1_048_576),
    cpuLimit: parseLimit(input.cpuLimit, "CPU (cores)", 1024),
  };
}

function runtimeSettingsFor(details: Awaited<ReturnType<typeof inspectDockerContainer>> | null): ContainerRuntimeSettings {
  const config = details?.Config;
  const host = details?.HostConfig;
  const logConfig = host?.LogConfig;
  return {
    command: config?.Cmd ?? [],
    entrypoint: config?.Entrypoint ?? [],
    workingDir: config?.WorkingDir ?? "",
    user: config?.User ?? "",
    tty: Boolean(config?.Tty),
    openStdin: Boolean(config?.OpenStdin),
    logDriver: logConfig?.Type ?? "",
    logOptions: logConfig?.Config ?? {},
    memoryLimitMiB: host?.Memory ? host.Memory / (1024 * 1024) : null,
    cpuLimit: host?.NanoCpus ? host.NanoCpus / 1_000_000_000 : host?.CpuQuota && host.CpuPeriod ? host.CpuQuota / host.CpuPeriod : null,
  };
}

function parseRestartPolicy(input: RestartPolicyInput | undefined, fallback: RestartPolicyInput | undefined = undefined): { name: RestartPolicy; maxRetries: number } | undefined {
  if (!input || input.name === "preserve") return undefined;
  const name = input.name;
  if (!name || !["no", "always", "unless-stopped", "on-failure"].includes(name)) throw new Error("La política de reinicio no es válida");
  const maxRetries = name === "on-failure" ? Math.max(0, Math.min(1000000, Math.trunc(Number(input.maxRetries) || 0))) : 0;
  return { name: name as RestartPolicy, maxRetries };
}

function restartPolicyFor(details: Awaited<ReturnType<typeof inspectDockerContainer>> | null) {
  const policy = details?.HostConfig?.RestartPolicy;
  const name = policy?.Name;
  return { name: name === "always" || name === "unless-stopped" || name === "on-failure" ? name : "no" as RestartPolicy, maxRetries: policy?.MaximumRetryCount ?? 0 };
}

function statusFor(container: DockerContainer) {
  if (container.State === "paused") return "paused" as const;
  if (container.State === "running" && /unhealthy/i.test(container.Status ?? "")) return "unhealthy" as const;
  if (container.State === "running" && /health:\s*starting/i.test(container.Status ?? "")) return "starting" as const;
  if (container.State === "running") return "running" as const;
  return "stopped" as const;
}

function readyFor(container: DockerContainer): boolean {
  return container.State === "running" && !/unhealthy|health:\s*starting/i.test(container.Status ?? "");
}

function publishedPorts(container: DockerContainer): string[] {
  return (container.Ports ?? []).filter((port) => port.PrivatePort).map((port) => {
    const host = port.PublicPort ? `${port.IP && port.IP !== "0.0.0.0" ? `${port.IP}:` : ""}${port.PublicPort}:` : "";
    return `${host}${port.PrivatePort}/${port.Type ?? "tcp"}`;
  });
}

function statusSince(container: DockerContainer): string | null {
  const status = container.Status ?? "";
  const spanishDuration = (value: string) => value
    .replace(/less than a second/i, "menos de un segundo")
    .replace(/less than a minute/i, "menos de un minuto")
    .replace(/about an hour/i, "aproximadamente una hora")
    .replace(/about a minute/i, "aproximadamente un minuto")
    .replace(/about a day/i, "aproximadamente un día")
    .replace(/seconds?/i, (match) => match.toLowerCase().startsWith("second") && !match.toLowerCase().startsWith("seconds") ? "segundo" : "segundos")
    .replace(/minutes?/i, (match) => match.toLowerCase().startsWith("minute") && !match.toLowerCase().startsWith("minutes") ? "minuto" : "minutos")
    .replace(/hours?/i, (match) => match.toLowerCase().startsWith("hour") && !match.toLowerCase().startsWith("hours") ? "hora" : "horas")
    .replace(/days?/i, (match) => match.toLowerCase().startsWith("day") && !match.toLowerCase().startsWith("days") ? "día" : "días")
    .replace(/weeks?/i, (match) => match.toLowerCase().startsWith("week") && !match.toLowerCase().startsWith("weeks") ? "semana" : "semanas")
    .replace(/months?/i, (match) => match.toLowerCase().startsWith("month") && !match.toLowerCase().startsWith("months") ? "mes" : "meses")
    .replace(/years?/i, (match) => match.toLowerCase().startsWith("year") && !match.toLowerCase().startsWith("years") ? "año" : "años");
  if (container.State === "running") {
    const match = status.match(/^Up\s+(.+?)(?:\s+\(|$)/i);
    return match ? `Activo desde hace ${spanishDuration(match[1])}` : "Activo";
  }
  const match = status.match(/(?:Exited|Created).*?\s(\d+\s+(?:second|minute|hour|day|week|month|year)s?\s+ago)/i);
  return match ? `Detenido desde hace ${spanishDuration(match[1].replace(/\s+ago$/i, ""))}` : (container.State === "created" ? "Creado, aún no iniciado" : "Detenido");
}

function publicPort(container: DockerContainer): number | null {
  return container.Ports?.find((port) => port.PublicPort)?.PublicPort ?? null;
}

function isPortalContainer(container: DockerContainer): boolean {
  const portalName = process.env.VESSEL_CONTAINER_NAME ?? "vessel";
  return (container.Names ?? []).some((name) => name.replace(/^\//, "") === portalName);
}

function serviceHost(request: Request): string {
  const configured = process.env.PUBLIC_SERVICE_HOST?.trim();
  if (configured) return configured;
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const origin = new URL(request.url);
  if (!forwarded) return origin.hostname;
  try {
    return new URL(`${origin.protocol}//${forwarded}`).hostname;
  } catch {
    return origin.hostname;
  }
}

function categoryFor(container: DockerContainer): ServiceCategory {
  const value = `${container.Names?.join(" ") ?? ""} ${container.Image ?? ""}`.toLowerCase();
  if (/postgres|mysql|mariadb|mongo|redis|database|db\b/.test(value)) return "database";
  if (/admin|runner|scheduler|jenkins|grafana|prometheus|n8n|traefik|nginx|proxy|gateway|monitor/.test(value)) return "external";
  return "application";
}

function dataResourceName(env: string[] | undefined): string | null {
  const values = new Map((env ?? []).map((item) => {
    const separator = item.indexOf("=");
    return separator < 0 ? [item, ""] : [item.slice(0, separator), item.slice(separator + 1)];
  }));
  const name = values.get("DB_NAME") || values.get("DATABASE_NAME") || values.get("ADEMPIERE_DB_NAME") || values.get("POSTGRES_DB") || values.get("MYSQL_DATABASE") || values.get("MARIADB_DATABASE");
  const host = values.get("DB_HOST") || values.get("DATABASE_HOST") || values.get("ADEMPIERE_DB_SERVER") || values.get("POSTGRES_HOST") || values.get("MYSQL_HOST") || values.get("MARIADB_HOST");
  if (name) return name;
  if (host) return host;
  const url = values.get("DATABASE_URL") || values.get("JDBC_URL") || values.get("ADEMPIERE_DB_URL");
  if (url) return url.split("/").pop()?.split("?")[0] || null;
  return null;
}

function imageVersion(image: string | null): string | null {
  if (!image) return null;
  if (image.startsWith("sha256:")) return image.slice(0, 19);
  const tag = image.split("@")[0].split(":").pop();
  return tag && tag !== image ? tag : (image.includes("@") ? image.split("@")[1].slice(0, 19) : null);
}

function nextPort(containers: DockerContainer[]): number {
  const used = new Set(containers.flatMap((container) => (container.Ports ?? []).map((port) => port.PublicPort).filter((port): port is number => typeof port === "number")));
  return Math.max(50000, ...used) + 1;
}

async function applySelectedNetwork(containerId: string | null, networkId: string | undefined, previousNetworkNames: string[]): Promise<void> {
  if (!containerId || !networkId || networkId === "preserve") return;
  const networks = await listDockerNetworks();
  const selected = networks.find((network) => network.Id === networkId);
  if (!selected) throw new Error("La red Docker seleccionada ya no existe");
  await connectDockerContainer(selected.Id, containerId);
  const previousNetworks = previousNetworkNames.filter((name) => name !== selected.Name);
  for (const networkName of previousNetworks) {
    const previous = networks.find((network) => network.Name === networkName);
    if (previous) {
      try {
        await disconnectDockerContainer(previous.Id, containerId);
      } catch (error) {
        throw new Error(`La nueva red se conectó, pero no se pudo retirar la red anterior ${networkName}: ${error instanceof Error ? error.message : "error desconocido"}`);
      }
    }
  }
}

export async function getServices(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isDockerConfigured()) {
    return NextResponse.json({ data: [], meta: { source: "vessel", dockerSync: "not-configured", discovered: 0, host: process.env.PUBLIC_SERVICE_HOST ?? "" } }, { status: 503 });
  }

  try {
    const containers = (await listDockerContainers()).filter((container) => !isPortalContainer(container));
    const host = serviceHost(request);
    const details = await Promise.all(containers.map((container) => inspectDockerContainer(container.Id).catch(() => null)));
    const services = containers.map((container, index) => {
      const name = (container.Names?.[0] ?? container.Id.slice(0, 12)).replace(/^\//, "");
      const port = publicPort(container);
      const status = statusFor(container);
      return {
        id: `container-${container.Id.slice(0, 12)}`,
        name,
        port: port ?? 0,
        host,
        url: port ? `http://${host}:${port}/webui/` : null,
        environment: "latest" as const,
        status,
        owner: "Vessel",
        source: "vessel" as const,
        category: categoryFor(container),
        statusSince: statusSince(container),
        databaseTarget: detectDataSource(details[index]?.Config?.Env)?.resourceName ?? dataResourceName(details[index]?.Config?.Env),
        dataCloneEngine: detectDataSource(details[index]?.Config?.Env)?.engine ?? null,
        ready: readyFor(container),
        image: container.Image ?? null,
        imageVersion: imageVersion(container.Image ?? null),
        networks: Object.keys(details[index]?.NetworkSettings?.Networks ?? {}),
        environmentVariables: details[index]?.Config?.Env ?? [],
        restartPolicy: restartPolicyFor(details[index]),
        runtimeSettings: details[index] ? runtimeSettingsFor(details[index]) : undefined,
        composeProject: container.Labels?.["com.docker.compose.project"] ?? null,
        composeService: container.Labels?.["com.docker.compose.service"] ?? null,
        createdAt: container.Created ?? null,
        ipAddresses: [...new Set(Object.values(details[index]?.NetworkSettings?.Networks ?? {}).flatMap((network) => [network.IPAddress, network.GlobalIPv6Address]).filter((address): address is string => Boolean(address)))],
        publishedPorts: publishedPorts(container),
        managedBy: container.Labels?.["com.docker.compose.project"] ? "Compose" : "Docker Engine",
      };
    });
    return NextResponse.json({ data: services, meta: { source: "vessel", dockerSync: "ok", discovered: containers.length, host } });
  } catch {
    return NextResponse.json({ data: [], meta: { source: "vessel", dockerSync: "error", discovered: 0, host: process.env.PUBLIC_SERVICE_HOST ?? "" } }, { status: 502 });
  }
}

export async function postServices(request: Request) {
  if (!mutationUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!isDockerConfigured()) {
    return NextResponse.json({ error: "El backend Docker no está configurado" }, { status: 503 });
  }

  let body: { serviceId?: string; action?: DockerAction | "recreate" | "create" | "edit" | "duplicate" | "delete"; newName?: string; newPort?: number; newImage?: string; internalPort?: number; targetDataName?: string; copyData?: boolean; networkId?: string; environmentVariables?: string[]; restartPolicy?: RestartPolicyInput; runtimeSettings?: RuntimeSettingsInput };
  try {
    body = await request.json() as { serviceId?: string; action?: DockerAction | "recreate" | "create" | "edit" | "duplicate" | "delete"; newName?: string; newPort?: number; newImage?: string; internalPort?: number; targetDataName?: string; copyData?: boolean; networkId?: string; environmentVariables?: string[]; restartPolicy?: RestartPolicyInput; runtimeSettings?: RuntimeSettingsInput };
  } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }

  let runtimeSettings: ContainerRuntimeSettings | undefined;
  try {
    runtimeSettings = parseRuntimeSettings(body.runtimeSettings);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Los ajustes de ejecución no son válidos" }, { status: 400 });
  }

  if (body.action === "create") {
    const newName = body.newName?.trim();
    const image = body.newImage?.trim();
    const publicPort = Number(body.newPort);
    const internalPort = Number(body.internalPort);
    if (!newName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(newName)) return NextResponse.json({ error: "El nombre del servicio no es válido" }, { status: 400 });
    if (!image || /\s/.test(image) || image.length > 512) return NextResponse.json({ error: "La imagen Docker no es válida" }, { status: 400 });
    if (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65535 || !Number.isInteger(internalPort) || internalPort < 1 || internalPort > 65535) return NextResponse.json({ error: "Los puertos deben estar entre 1 y 65535" }, { status: 400 });
    try {
      const containers = await listDockerContainers();
      if (containers.some((container) => (container.Names ?? []).some((name) => name.replace(/^\//, "") === newName))) return NextResponse.json({ error: "Ya existe un contenedor con ese nombre" }, { status: 409 });
      if (containers.some((container) => container.Ports?.some((port) => port.PublicPort === publicPort))) return NextResponse.json({ error: "El puerto ya está ocupado" }, { status: 409 });
      if (body.networkId && !(await listDockerNetworks()).some((network) => network.Id === body.networkId)) return NextResponse.json({ error: "La red Docker seleccionada no existe" }, { status: 400 });
      const job = startOperationJob("image", async (update) => {
        update({ step: "pulling_image", message: "Preparando descarga de imagen", percent: 1 });
        await createDockerContainer(newName, image, internalPort, publicPort, (percent, message) => update({ step: "pulling_image", message, percent }), body.environmentVariables, parseRestartPolicy(body.restartPolicy) ?? { name: "no" }, runtimeSettings, body.networkId);
        update({ step: "starting", message: "Servicio creado y verificado", percent: 100 });
        return { name: newName, port: publicPort, dataResource: "", dataCopied: false };
      });
      return NextResponse.json({ ok: true, action: "create", jobId: job.id, name: newName, port: publicPort, image }, { status: 202 });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "No fue posible preparar el servicio" }, { status: 502 });
    }
  }

  if (!body.serviceId || !body.action || !["start", "stop", "restart", "kill", "pause", "unpause", "recreate", "edit", "duplicate", "delete"].includes(body.action)) {
    return NextResponse.json({ error: "serviceId y action son obligatorios" }, { status: 400 });
  }

  try {
    const containers = await listDockerContainers();
    const target = containers.find((container) => {
      return body.serviceId === `container-${container.Id.slice(0, 12)}`;
    });

    if (!target) return NextResponse.json({ error: "No se encontró el contenedor en Docker" }, { status: 404 });

    if (body.action === "delete") {
      await deleteDockerContainer(target.Id);
      return NextResponse.json({ ok: true, action: "delete", containerId: target.Id });
    }

    if (["start", "stop", "restart", "kill", "pause", "unpause"].includes(body.action)) {
      await controlDockerContainer(target.Id, body.action as DockerAction);
      return NextResponse.json({ ok: true, action: body.action, containerId: target.Id });
    }

    if (body.action === "edit") {
      if (target.Labels?.["com.docker.compose.project"]) return NextResponse.json({ error: "Este contenedor está gestionado por Compose. Modifica su configuración desde el proyecto Compose para evitar que los cambios se reviertan." }, { status: 409 });
      const newName = body.newName?.trim();
      const newPort = Number(body.newPort);
      const newImage = body.newImage?.trim();
      if (!newName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(newName)) return NextResponse.json({ error: "El nombre no es válido" }, { status: 400 });
      if (!Number.isInteger(newPort) || newPort < 1 || newPort > 65535) return NextResponse.json({ error: "El puerto debe estar entre 1 y 65535" }, { status: 400 });
      if (!newImage || /\s/.test(newImage) || newImage.length > 512) return NextResponse.json({ error: "La imagen Docker no es válida" }, { status: 400 });
      const duplicateName = containers.some((container) => (container.Names ?? []).some((name) => name.replace(/^\//, "") === newName && container.Id !== target.Id));
      if (duplicateName) return NextResponse.json({ error: "Ya existe un contenedor con ese nombre" }, { status: 409 });
      const usedPort = containers.some((container) => container.Id !== target.Id && container.Ports?.some((port) => port.PublicPort === newPort));
      if (usedPort) return NextResponse.json({ error: "El puerto ya está ocupado" }, { status: 409 });
      const oldPort = target.Ports?.find((port) => port.PublicPort)?.PublicPort ?? null;
      const targetDetails = await inspectDockerContainer(target.Id);
      const restartPolicy = parseRestartPolicy(body.restartPolicy);
      const previousNetworkNames = Object.keys(targetDetails.NetworkSettings?.Networks ?? {});
      if (newImage !== target.Image) {
        const createImageJob = () => startOperationJob("image", async (update) => {
          update({ step: "pulling_image", message: "Preparando descarga de imagen", percent: 1 });
          const recreatedId = await recreateDockerContainer(target.Id, newName, oldPort, newPort, newImage, (percent, message) => update({ step: "pulling_image", message, percent }), body.environmentVariables, restartPolicy, runtimeSettings);
          await applySelectedNetwork(recreatedId, body.networkId, previousNetworkNames);
          update({ step: "starting", message: "Imagen aplicada y servicio verificado", percent: 100 });
          return { name: newName, port: newPort, dataResource: "", dataCopied: false };
        }, createImageJob);
        const job = createImageJob();
        return NextResponse.json({ ok: true, action: "edit", jobId: job.id, name: newName, port: newPort, image: newImage }, { status: 202 });
      }
      const recreatedId = await recreateDockerContainer(target.Id, newName, oldPort, newPort, newImage, undefined, body.environmentVariables, restartPolicy, runtimeSettings);
      await applySelectedNetwork(recreatedId, body.networkId, previousNetworkNames);
      return NextResponse.json({ ok: true, action: "edit", name: newName, port: newPort, image: newImage });
    }

    if (body.action === "duplicate") {
      const newName = body.newName?.trim();
      const copyData = body.copyData !== false;
      const newImage = body.newImage?.trim();
      const sourceDetails = await inspectDockerContainer(target.Id);
      const restartPolicy = parseRestartPolicy(body.restartPolicy);
      const sourceEnv = sourceDetails.Config?.Env ?? [];
      const dataSource = detectDataSource(sourceEnv);
      const sourceDataName = dataSource?.resourceName ?? dataResourceName(sourceEnv);
      const targetDataName = copyData ? body.targetDataName?.trim() || "" : sourceDataName;
      const hasPublishedPort = Object.values(sourceDetails.HostConfig?.PortBindings ?? {}).flat().some((binding) => Boolean(binding.HostPort));
      const newPort = hasPublishedPort ? (body.newPort ? Number(body.newPort) : nextPort(containers)) : 0;
      if (!newName || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(newName)) return NextResponse.json({ error: "El nombre del contenedor no es válido" }, { status: 400 });
      if (!newImage || /\s/.test(newImage) || newImage.length > 512) return NextResponse.json({ error: "La imagen Docker no es válida" }, { status: 400 });
      if (copyData && !dataSource) return NextResponse.json({ error: "No se detectó un origen de datos compatible. Revisa el motor y las variables de conexión del contenedor." }, { status: 400 });
      if (copyData && (!targetDataName || !validDataResourceName(dataSource!.engine, targetDataName))) return NextResponse.json({ error: "El nombre del recurso de datos no es válido para el motor detectado" }, { status: 400 });
      if (hasPublishedPort && (!Number.isInteger(newPort) || newPort < 1 || newPort > 65535)) return NextResponse.json({ error: "El puerto debe estar entre 1 y 65535" }, { status: 400 });
      if (/(^|[_-])prod(?:uction)?($|[_-])/i.test((target.Names?.[0] ?? "").replace(/^\//, ""))) return NextResponse.json({ error: "Por seguridad no se permite duplicar un contenedor de producción" }, { status: 403 });
      const duplicateName = containers.some((container) => (container.Names ?? []).some((name) => name.replace(/^\//, "") === newName));
      if (duplicateName) return NextResponse.json({ error: "Ya existe un contenedor con ese nombre" }, { status: 409 });
      const usedPort = newPort > 0 && containers.some((container) => container.Ports?.some((port) => port.PublicPort === newPort));
      if (usedPort) return NextResponse.json({ error: "El puerto ya está ocupado" }, { status: 409 });
      const job = startCloneJob(async (update) => {
        const copied = copyData ? await cloneDataResource(sourceEnv, targetDataName!, (patch) => update({ ...patch, currentItem: patch.currentItem ?? null })) : null;
        update({ step: "creating_container", message: "Creando el contenedor duplicado", percent: 94, currentItem: null, errors: copied?.errors ?? 0 });
        const newEnvironment = copyData ? updateDataResourceName(dataSource!, sourceEnv, body.environmentVariables, targetDataName!) : body.environmentVariables;
        const cloned = await cloneDockerContainer(target.Id, newName, newPort, newImage, (percent, message) => update({ step: "pulling_image", message, percent }), newEnvironment, restartPolicy, runtimeSettings);
        await applySelectedNetwork(cloned.containerId, body.networkId, Object.keys(sourceDetails.NetworkSettings?.Networks ?? {}));
        update({ step: "starting", message: "Verificando el nuevo servicio", percent: 98 });
        return { name: newName, port: newPort, dataResource: targetDataName ?? "", dataCopied: copyData };
      }, !copyData && Boolean(sourceDataName));
      return NextResponse.json({ ok: true, action: "duplicate", jobId: job.id, name: newName, port: newPort, dataResource: targetDataName, dataCopied: copyData }, { status: 202 });
    }

    if (body.action === "recreate") {
      const name = (target.Names?.[0] ?? target.Id.slice(0, 12)).replace(/^\//, "");
      const port = target.Ports?.find((item) => item.PublicPort)?.PublicPort ?? null;
      await recreateDockerContainer(target.Id, name, port, port, target.Image);
      return NextResponse.json({ ok: true, action: "recreate", containerId: target.Id });
    }

    await controlDockerContainer(target.Id, body.action);
    return NextResponse.json({ ok: true, action: body.action, containerId: target.Id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible ejecutar la acción";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
