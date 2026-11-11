import { readFile, statfs } from "node:fs/promises";
import { NextResponse } from "next/server";
import { authenticatedUser, userHasPermission } from "@/lib/control-plane";
import { dockerApiBase, dockerGet } from "@/lib/docker/client";
import { listRemoteServers, remoteServerWithKey } from "@/lib/remote-servers";
import { currentDockerEngineId } from "@/lib/docker/engine-context";

type DockerSystemDisk = {
  LayersSize?: number;
  Images?: Array<{ Size?: number }>;
  Containers?: Array<{ SizeRw?: number }>;
  Volumes?: Array<{ UsageData?: { Size?: number } }>;
  BuildCache?: Array<{ Size?: number }>;
};
type DockerContainer = { Id: string };
type DockerContainerStats = {
  blkio_stats?: { io_service_bytes_recursive?: Array<{ op?: string; value?: number }> | null };
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>;
};
type MetricResult<T> = { value: T | null; error: string | null };

const sumBytes = (values: Array<number | undefined>) => values.reduce<number>((sum, value) => sum + (Number.isFinite(value) && value! > 0 ? value! : 0), 0);

async function optionalMetric<T>(operation: () => Promise<T>): Promise<MetricResult<T>> {
  try {
    return { value: await operation(), error: null };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : "Docker request failed" };
  }
}

async function dockerStorageUsage() {
  const disk = await dockerGet<DockerSystemDisk>("system/df");
  // LayersSize is Docker's deduplicated total; summing image Size would count shared layers repeatedly.
  const images = Number.isFinite(disk.LayersSize) && disk.LayersSize! >= 0 ? disk.LayersSize! : sumBytes((disk.Images ?? []).map((item) => item.Size));
  const containers = sumBytes((disk.Containers ?? []).map((item) => item.SizeRw));
  const volumes = sumBytes((disk.Volumes ?? []).map((item) => item.UsageData?.Size));
  const buildCache = sumBytes((disk.BuildCache ?? []).map((item) => item.Size));
  return { images, containers, volumes, buildCache, total: images + containers + volumes + buildCache };
}

async function dockerIoUsage() {
  const containers = await dockerGet<DockerContainer[]>("containers/json?all=0");
  let blockRead = 0;
  let blockWrite = 0;
  let networkIn = 0;
  let networkOut = 0;
  let failedContainers = 0;
  const batchSize = 4;
  for (let offset = 0; offset < containers.length; offset += batchSize) {
    const batch = containers.slice(offset, offset + batchSize);
    const stats = await Promise.allSettled(batch.map(({ Id }) => dockerGet<DockerContainerStats>(`containers/${encodeURIComponent(Id)}/stats?stream=false`)));
    for (const result of stats) {
      if (result.status !== "fulfilled") {
        failedContainers += 1;
        continue;
      }
      const stats = result.value;
      for (const io of stats.blkio_stats?.io_service_bytes_recursive ?? []) {
        if (io.op?.toLowerCase() === "read") blockRead += io.value ?? 0;
        if (io.op?.toLowerCase() === "write") blockWrite += io.value ?? 0;
      }
      for (const network of Object.values(stats.networks ?? {})) {
        networkIn += network.rx_bytes ?? 0;
        networkOut += network.tx_bytes ?? 0;
      }
    }
  }
  if (containers.length > 0 && failedContainers === containers.length) throw new Error("Docker no devolvió estadísticas de ningún contenedor");
  return { blockRead, blockWrite, networkIn, networkOut, containers: containers.length, failedContainers };
}

function cpuTotals(text: string) {
  const values = text.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { total, idle: (values[3] ?? 0) + (values[4] ?? 0) };
}

function memoryKilobytes(text: string, key: string) {
  return Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
}

export async function getMetrics(request: Request) {
  const user = authenticatedUser(request);
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  if (!userHasPermission(user, "overview.view")) return NextResponse.json({ error: "Permission denied" }, { status: 403 });
  const params = new URL(request.url).searchParams;
  const engineId = params.get("engineId") ?? currentDockerEngineId();
  const hostOnly = params.get("hostOnly") === "1";
  const detailsOnly = params.get("detailsOnly") === "1";
  if (engineId && engineId !== "local") {
    const engine = remoteServerWithKey(engineId);
    if (!engine) return NextResponse.json({ error: "Registered server not found" }, { status: 404 });
    try {
      const dockerDetails = async () => {
        const [dockerDisk, io] = await Promise.all([optionalMetric(dockerStorageUsage), optionalMetric(dockerIoUsage)]);
        return { dockerDisk: dockerDisk.value, dockerDiskError: dockerDisk.error, io: io.value, ioError: io.error };
      };
      if (detailsOnly) return NextResponse.json({ ...await dockerDetails(), sampledAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
      const base = dockerApiBase();
      const response = await fetch(`${base}/engines/metrics/${encodeURIComponent(engine.id)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return NextResponse.json({ error: "Remote host metrics are not available" }, { status: 502 });
      const remoteHostMetrics = await response.json() as Record<string, unknown>;
      if (hostOnly) return NextResponse.json({ ...remoteHostMetrics, dockerDisk: null, dockerDiskError: null, io: null, ioError: null, server: { id: engine.id, name: engine.name, host: engine.host }, remoteServers: listRemoteServers().map(({ id, name, host }) => ({ id, name, host })) }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
      const details = await dockerDetails();
      return NextResponse.json({
        ...remoteHostMetrics,
        ...details,
        server: { id: engine.id, name: engine.name, host: engine.host },
        remoteServers: listRemoteServers().map(({ id, name, host }) => ({ id, name, host })),
      }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
    } catch {
      return NextResponse.json({ error: "Remote host metrics are not available" }, { status: 502 });
    }
  }
  try {
    if (detailsOnly) {
      const [dockerDisk, io] = await Promise.all([optionalMetric(dockerStorageUsage), optionalMetric(dockerIoUsage)]);
      return NextResponse.json({ dockerDisk: dockerDisk.value, dockerDiskError: dockerDisk.error, io: io.value, ioError: io.error, sampledAt: new Date().toISOString() }, { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization" } });
    }
    const first = cpuTotals(await readFile("/proc/stat", "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [stat, memoryText, disk, uptimeText, dockerDisk, io] = await Promise.all([
      readFile("/proc/stat", "utf8"),
      readFile("/proc/meminfo", "utf8"),
      statfs(process.env.VESSEL_METRICS_PATH ?? "/app/data").catch(() => statfs(process.cwd())),
      readFile("/proc/uptime", "utf8").catch(() => ""),
      hostOnly ? Promise.resolve({ value: null, error: null }) : optionalMetric(dockerStorageUsage),
      hostOnly ? Promise.resolve({ value: null, error: null }) : optionalMetric(dockerIoUsage),
    ]);
    const second = cpuTotals(stat);
    const totalTicks = second.total - first.total;
    const cpuPercent = totalTicks > 0 ? Math.max(0, Math.min(100, 100 * (1 - (second.idle - first.idle) / totalTicks))) : 0;
    const memoryTotal = memoryKilobytes(memoryText, "MemTotal") * 1024;
    const memoryAvailable = memoryKilobytes(memoryText, "MemAvailable") * 1024;
    const diskTotal = Number(disk.blocks) * Number(disk.bsize);
    const diskUsed = (Number(disk.blocks) - Number(disk.bfree)) * Number(disk.bsize);
    return NextResponse.json({
      cpu: { percent: cpuPercent },
      memory: { used: Math.max(0, memoryTotal - memoryAvailable), total: memoryTotal },
      disk: { used: diskUsed, total: diskTotal, source: "vessel-data-filesystem", type: "unknown" },
      uptimeSeconds: Math.max(0, Number.parseFloat(uptimeText.split(/\s+/)[0] ?? "") || 0),
      packageUpdates: { supported: false, available: 0, security: 0 },
      dockerDisk: dockerDisk.value,
      dockerDiskError: dockerDisk.error,
      io: io.value,
      ioError: io.error,
      sampledAt: new Date().toISOString(),
      remoteServers: listRemoteServers().map(({ id, name, host }) => ({ id, name, host })),
    });
  } catch {
    return NextResponse.json({ error: "Host metrics are not available" }, { status: 503 });
  }
}
