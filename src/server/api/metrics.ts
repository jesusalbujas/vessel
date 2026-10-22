import { readFile, statfs } from "node:fs/promises";
import { NextResponse } from "next/server";
import { authenticatedUser } from "@/lib/control-plane";

function cpuTotals(text: string) {
  const values = text.split("\n")[0].trim().split(/\s+/).slice(1).map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { total, idle: (values[3] ?? 0) + (values[4] ?? 0) };
}

function memoryKilobytes(text: string, key: string) {
  return Number(text.match(new RegExp(`^${key}:\\s+(\\d+)`, "m"))?.[1] ?? 0);
}

export async function getMetrics(request: Request) {
  if (!authenticatedUser(request)) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  try {
    const first = cpuTotals(await readFile("/proc/stat", "utf8"));
    await new Promise((resolve) => setTimeout(resolve, 300));
    const [stat, memoryText, disk] = await Promise.all([
      readFile("/proc/stat", "utf8"),
      readFile("/proc/meminfo", "utf8"),
      statfs(process.env.VESSEL_METRICS_PATH ?? "/app/data").catch(() => statfs(process.cwd())),
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
      disk: { used: diskUsed, total: diskTotal, source: "vessel-data-filesystem" },
      sampledAt: new Date().toISOString(),
    });
  } catch {
    return NextResponse.json({ error: "Host metrics are not available" }, { status: 503 });
  }
}
